import { GoogleGenAI, Type } from "@google/genai";
import { PDFDocument } from 'pdf-lib';
import ExcelJS from 'exceljs';

const getAi = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Gemini API Key is missing. Please set the API key first.");
  }
  return new GoogleGenAI({ apiKey });
};

export interface CostcoOrder {
  orderNumber: string;
  productCode: string;
  productName: string;
  quantity: string;
  supplyPrice: string;
  recipientName: string;
  recipientPhone: string;
  shippingAddress: string;
  shippingMessage: string;
  zipCode: string;
}

const CHUNK_SIZE = 5;

async function extractCostcoOrdersFromBase64Pdf(base64Pdf: string): Promise<CostcoOrder[]> {
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
            text: "이 코스트코 발주서 PDF에서 주문 정보를 추출해주세요. 각 주문마다 다음 정보를 찾아야 합니다:\n1. 주문번호\n2. 상품번호(상품코드)\n3. 상품명\n4. 수량\n5. 공급가(금액): 첨부된 이미지나 표에서 상품명 우측에 위치한 가격(예: 20,900, 19,800 등)을 반드시 찾아서 기재하세요. 절대 빈칸이나 0으로 두지 마세요.\n6. 수취인\n7. 수취인핸드폰\n8. 배송주소(여러 줄로 나뉘어 있으면 한 줄로 합쳐주세요)\n9. 배송메시지(없으면 빈 문자열)\n10. 우편번호\n\n결과는 JSON 배열로 반환해주세요.",
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
              orderNumber: { type: Type.STRING, description: "주문번호" },
              productCode: { type: Type.STRING, description: "상품번호" },
              productName: { type: Type.STRING, description: "상품명" },
              quantity: { type: Type.STRING, description: "수량" },
              supplyPrice: { type: Type.STRING, description: "공급가 (예: 20,900)" },
              recipientName: { type: Type.STRING, description: "수취인" },
              recipientPhone: { type: Type.STRING, description: "수취인 핸드폰" },
              shippingAddress: { type: Type.STRING, description: "배송주소 (전체 주소)" },
              shippingMessage: { type: Type.STRING, description: "배송메시지" },
              zipCode: { type: Type.STRING, description: "우편번호" },
            },
            required: ["orderNumber", "productCode", "productName", "quantity", "supplyPrice", "recipientName", "recipientPhone", "shippingAddress", "zipCode"],
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

    let orders: CostcoOrder[] = [];
    try {
      orders = JSON.parse(jsonStr);
    } catch (parseError) {
      console.warn("Failed to parse JSON directly, attempting regex extraction", parseError);
      // Fallback: try to extract JSON array using regex
      const match = jsonStr.match(/\[[\s\S]*\]/);
      if (match) {
        orders = JSON.parse(match[0]);
      } else {
        throw new Error("응답에서 유효한 JSON 데이터를 찾을 수 없습니다.");
      }
    }
    
    // 특정 상품에 대한 공급가 명시적 보정 (사용자 요청)
    return orders.map(order => {
      if (order.productName.includes("바슈롬 바이오 트루 다목적액") && order.productName.includes("300ml")) {
        order.supplyPrice = "19,800";
      } else if (order.productName.includes("바슈롬 리뉴 후레쉬 용액") && order.productName.includes("500ml")) {
        order.supplyPrice = "20,900";
      }
      return order;
    });
  } catch (error: any) {
    console.error("Error extracting Costco orders from PDF chunk:", error);
    
    if (error.message?.includes('429') || error.message?.includes('Quota')) {
      throw new Error("AI API 호출 한도를 초과했습니다. 1~2분 정도 기다리신 후 다시 시도해주세요.");
    }
    if (error.message?.includes('exceeds the maximum number of tokens')) {
      throw new Error("문서 내용이 너무 복잡하여 분석 한도를 초과했습니다. PDF 파일을 더 작은 단위로 쪼개서 업로드해주세요.");
    }
    if (error.message?.includes('503') || error.message?.includes('overloaded')) {
      throw new Error("현재 AI 서버에 일시적인 과부하가 발생했습니다. 잠시 후 다시 시도해주세요.");
    }
    
    throw new Error(`PDF 분석 중 오류가 발생했습니다. 파일을 확인하고 다시 시도해주세요. (상세: ${error.message || '알 수 없는 오류'})`);
  }
}

export async function processCostcoPdfDoc(
  pdfDoc: PDFDocument,
  onChunkComplete: () => void
): Promise<CostcoOrder[]> {
  try {
    const pageCount = pdfDoc.getPageCount();
    const chunkFunctions: (() => Promise<CostcoOrder[]>)[] = [];

    for (let i = 0; i < pageCount; i += CHUNK_SIZE) {
      chunkFunctions.push(async () => {
        const chunkPdf = await PDFDocument.create();
        const end = Math.min(i + CHUNK_SIZE, pageCount);
        const pageIndices = Array.from({ length: end - i }, (_, idx) => i + idx);
        
        const copiedPages = await chunkPdf.copyPages(pdfDoc, pageIndices);
        copiedPages.forEach((page) => chunkPdf.addPage(page));
        
        const chunkBase64 = await chunkPdf.saveAsBase64();
        const result = await extractCostcoOrdersFromBase64Pdf(chunkBase64);
        
        onChunkComplete();
        return result;
      });
    }

    let allOrders: CostcoOrder[] = [];
    
    // Process in batches of 5 to avoid rate limits
    for (let i = 0; i < chunkFunctions.length; i += 5) {
      const batch = chunkFunctions.slice(i, i + 5);
      const batchResults = await Promise.all(batch.map(fn => fn()));
      for (const extracted of batchResults) {
        allOrders = [...allOrders, ...extracted];
      }
    }

    return allOrders;
  } catch (error) {
    console.error("Error processing Costco PDF document:", error);
    throw error;
  }
}

export async function generateCostcoExcel(orders: CostcoOrder[]): Promise<Blob> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('발주서');

  const headers = [
    "주문번호", "상품코드", "상품명", "수량", "판매가", "공급가",
    "주문자", "주문자핸드폰", "수취인", "수취인핸드폰", "수취인주소",
    "배송메세지", "우편번호"
  ];

  worksheet.addRow(headers);

  orders.forEach(order => {
    worksheet.addRow([
      order.orderNumber,
      order.productCode,
      order.productName,
      order.quantity,
      "", // 판매가
      order.supplyPrice || "", // 공급가
      "", // 주문자
      "", // 주문자핸드폰
      order.recipientName,
      order.recipientPhone,
      order.shippingAddress,
      order.shippingMessage || "",
      order.zipCode
    ]);
  });

  // Apply header styling and right alignment
  worksheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    row.eachCell({ includeEmpty: true }, (cell) => {
      // Set right alignment for all cells safely
      cell.alignment = { 
        ...(cell.alignment || {}), 
        horizontal: 'right', 
        vertical: 'middle' 
      };
      
      // Set header background color (Row 1)
      if (rowNumber === 1) {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFBCE3EB' } // Light blue color
        };
        cell.font = {
          ...(cell.font || {}),
          bold: true
        };
      }
    });
  });

  // Adjust column widths roughly for better readability
  worksheet.columns.forEach(column => {
    if (column) column.width = 15;
  });
  const productNameCol = worksheet.getColumn(3);
  if (productNameCol) productNameCol.width = 40;
  const addressCol = worksheet.getColumn(11);
  if (addressCol) addressCol.width = 50;

  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
