import { GoogleGenAI, Type } from "@google/genai";
import { PDFDocument } from 'pdf-lib';

const getAi = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Gemini API Key is missing. Please set the API key first.");
  }
  return new GoogleGenAI({ apiKey });
};

export interface ProductMapping {
  productName: string;
  productCode: string;
}

export const CHUNK_SIZE = 5;

async function extractMappingsFromBase64Pdf(base64Pdf: string): Promise<ProductMapping[]> {
  try {
    const ai = getAi();
    const response = await ai.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: "application/pdf",
              data: base64Pdf,
            },
          },
          {
            text: "이 문서에서 '주문상품명'(또는 상품명)과 '상품코드' 쌍을 모두 추출해주세요. 정확한 상품명과 상품코드를 매칭해야 합니다. 결과는 JSON 배열로 반환해주세요.",
          },
        ],
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              productName: {
                type: Type.STRING,
                description: "주문상품명 (Order Product Name)",
              },
              productCode: {
                type: Type.STRING,
                description: "상품코드 (Product Code)",
              },
            },
            required: ["productName", "productCode"],
          },
        },
      },
    });

    let jsonStr = response.text?.trim();
    if (!jsonStr) return [];

    // Remove markdown code block wrappers if present
    if (jsonStr.startsWith('```json')) {
      jsonStr = jsonStr.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
    } else if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```\n?/, '').replace(/\n?```$/, '').trim();
    }

    let mappings: ProductMapping[] = [];
    try {
      mappings = JSON.parse(jsonStr);
    } catch (parseError) {
      console.warn("Failed to parse JSON directly, attempting regex extraction", parseError);
      const match = jsonStr.match(/\[[\s\S]*\]/);
      if (match) {
        mappings = JSON.parse(match[0]);
      } else {
        throw new Error("응답에서 유효한 JSON 데이터를 찾을 수 없습니다.");
      }
    }
    
    return mappings;
  } catch (error: any) {
    console.error("Error extracting mappings from PDF chunk:", error);
    const errMsg = error.message?.toLowerCase() || "";
    
    // Provide actionable error messages based on the error type
    if (errMsg.includes("429") || errMsg.includes("quota") || errMsg.includes("rate limit")) {
      throw new Error("AI API 호출 한도를 초과했습니다. 1~2분 정도 기다리신 후 다시 시도해주세요.");
    } else if (errMsg.includes("400") || errMsg.includes("token")) {
      throw new Error("문서 내용이 너무 복잡하여 분석 한도를 초과했습니다. PDF 파일을 더 작은 단위로 쪼개서 업로드해주세요.");
    } else if (errMsg.includes("503") || errMsg.includes("overloaded")) {
      throw new Error("현재 AI 서버에 일시적인 과부하가 발생했습니다. 잠시 후 다시 시도해주세요.");
    }
    
    throw new Error("AI 분석 중 예상치 못한 오류가 발생했습니다. 네트워크 상태를 확인하거나 잠시 후 다시 시도해주세요.");
  }
}

export async function extractMappingsFromPdfDoc(
  pdfDoc: PDFDocument,
  onChunkComplete: () => void
): Promise<ProductMapping[]> {
  try {
    const pageCount = pdfDoc.getPageCount();
    const chunkFunctions: (() => Promise<ProductMapping[]>)[] = [];

    for (let i = 0; i < pageCount; i += CHUNK_SIZE) {
      chunkFunctions.push(async () => {
        const chunkPdf = await PDFDocument.create();
        const end = Math.min(i + CHUNK_SIZE, pageCount);
        const pageIndices = Array.from({ length: end - i }, (_, idx) => i + idx);
        
        const copiedPages = await chunkPdf.copyPages(pdfDoc, pageIndices);
        copiedPages.forEach((page) => chunkPdf.addPage(page));
        
        const chunkBase64 = await chunkPdf.saveAsBase64();
        const result = await extractMappingsFromBase64Pdf(chunkBase64);
        
        // Notify progress
        onChunkComplete();
        
        return result;
      });
    }

    let allMappings: ProductMapping[] = [];
    
    // Process chunks concurrently in batches of 5 to speed up with Gemini 3.1
    for (let i = 0; i < chunkFunctions.length; i += 5) {
      const batch = chunkFunctions.slice(i, i + 5);
      const batchResults = await Promise.all(batch.map(fn => fn()));
      for (const extracted of batchResults) {
        allMappings = [...allMappings, ...extracted];
      }
    }

    return allMappings;
  } catch (error) {
    console.error("Error processing PDF document:", error);
    throw error;
  }
}
