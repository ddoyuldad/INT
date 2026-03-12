import { GoogleGenAI, Type } from '@google/genai';
import { PDFDocument } from 'pdf-lib';
import ExcelJS from 'exceljs';

const getAi = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Gemini API Key is missing. Please set the API key first.");
  }
  return new GoogleGenAI({ apiKey });
};

export const CHUNK_SIZE = 5;

export interface MappingRule {
  siteProductName: string; // V행
  optionName: string;      // P행
  quantity: string;        // S행
  mappedItemName: string;  // G행
}

export async function extractMappingRulesFromPdfDoc(
  pdfDoc: PDFDocument,
  onProgress: () => void
): Promise<MappingRule[]> {
  const ai = getAi();
  const pages = pdfDoc.getPages();
  const totalChunks = Math.ceil(pages.length / CHUNK_SIZE);
  let allRules: MappingRule[] = [];

  for (let i = 0; i < totalChunks; i++) {
    const newPdfDoc = await PDFDocument.create();
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, pages.length);
    const copiedPages = await newPdfDoc.copyPages(pdfDoc, Array.from({ length: end - start }, (_, idx) => start + idx));
    copiedPages.forEach((page) => newPdfDoc.addPage(page));

    const pdfBytes = await newPdfDoc.save();
    const base64String = btoa(
      new Uint8Array(pdfBytes).reduce((data, byte) => data + String.fromCharCode(byte), '')
    );

    const prompt = `
이 PDF 파일은 사방넷 매핑이 잘 되어 있는 예시 데이터입니다.
다음 정보를 추출하여 JSON 배열로 반환해주세요:
- siteProductName: 사이트수집상품명 (V행에 해당하는 정보)
- optionName: 옵션명 (P행에 해당하는 정보)
- quantity: 주문수량 (S행에 해당하는 정보)
- mappedItemName: 품목명 (G행에 해당하는 정보, 보통 '매핑 상품명 [수량]' 형태)

가능한 많은 매핑 예시를 추출해주세요.
`;

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3.1-pro-preview',
        contents: {
          parts: [
            {
              inlineData: {
                data: base64String,
                mimeType: 'application/pdf',
              },
            },
            { text: prompt },
          ],
        },
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                siteProductName: { type: Type.STRING },
                optionName: { type: Type.STRING },
                quantity: { type: Type.STRING },
                mappedItemName: { type: Type.STRING },
              },
              required: ['siteProductName', 'optionName', 'quantity', 'mappedItemName'],
            },
          },
        },
      });

      let jsonStr = response.text?.trim() || '[]';
      
      // Remove markdown code block wrappers if present
      if (jsonStr.startsWith('```json')) {
        jsonStr = jsonStr.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
      } else if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```\n?/, '').replace(/\n?```$/, '').trim();
      }

      let rules: MappingRule[] = [];
      try {
        rules = JSON.parse(jsonStr);
      } catch (parseError) {
        console.warn("Failed to parse JSON directly, attempting regex extraction", parseError);
        const match = jsonStr.match(/\[[\s\S]*\]/);
        if (match) {
          rules = JSON.parse(match[0]);
        } else {
          throw new Error("응답에서 유효한 JSON 데이터를 찾을 수 없습니다.");
        }
      }
      
      allRules = [...allRules, ...rules];
    } catch (e) {
      console.error('Failed to parse JSON from Gemini', e);
      // Continue to next chunk even if one fails
    }
    onProgress();
  }

  return allRules;
}

export async function extractMappingRulesFromExcel(
  file: File
): Promise<MappingRule[]> {
  const arrayBuffer = await file.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(arrayBuffer);
  const worksheet = workbook.worksheets[0];
  
  const rules: MappingRule[] = [];
  
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // Skip header
    
    const vVal = row.getCell('V').text?.trim();
    const pVal = row.getCell('P').text?.trim();
    const sVal = row.getCell('S').text?.trim();
    const gVal = row.getCell('G').text?.trim();
    
    // V, P, S, G가 모두 있는 경우만 유효한 매핑 규칙으로 간주
    if (vVal && pVal && sVal && gVal) {
      rules.push({
        siteProductName: vVal,
        optionName: pVal,
        quantity: sVal,
        mappedItemName: gVal
      });
    }
  });
  
  return rules;
}

export async function processMappingExcelFile(
  file: File,
  rules: MappingRule[],
  onProgress: (current: number, total: number) => void
): Promise<Blob> {
  const ai = getAi();
  const arrayBuffer = await file.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(arrayBuffer);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error('엑셀 파일에 시트가 없습니다.');
  }

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

  const uniqueItemsMap = new Map<string, {
    vVal: string;
    pVal: string;
    sVal: string;
    gVal: string;
    rowNumbers: number[];
  }>();

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // Skip header
    const gVal = row.getCell('G').text || '';
    const pVal = row.getCell('P').text || '';
    const sVal = row.getCell('S').text || '';
    const vVal = row.getCell('V').text || '';
    
    if (vVal || pVal || sVal || gVal) {
      const key = `${vVal}|${pVal}|${sVal}|${gVal}`;
      if (!uniqueItemsMap.has(key)) {
        uniqueItemsMap.set(key, { vVal, pVal, sVal, gVal, rowNumbers: [] });
      }
      uniqueItemsMap.get(key)!.rowNumbers.push(rowNumber);
    }
  });

  const uniqueItemsToEvaluate = Array.from(uniqueItemsMap.values()).map((item, index) => ({
    id: index,
    vVal: item.vVal,
    pVal: item.pVal,
    sVal: item.sVal,
    gVal: item.gVal,
    rowNumbers: item.rowNumbers
  }));

  const BATCH_SIZE = 50;
  const totalBatches = Math.ceil(uniqueItemsToEvaluate.length / BATCH_SIZE);
  
  // To avoid token limits, we only send a subset of rules as examples
  // Gemini 3.1 Pro has a large context window, so we can send more rules to improve accuracy
  const sampleRules = rules.slice(0, 200);
  
  let completedBatches = 0;
  
  // If there are no batches, just return early
  if (totalBatches === 0) {
    const buffer = await workbook.xlsx.writeBuffer();
    return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  const incorrectRowNumbers = new Set<number>();
  const rowNotes = new Map<number, string>();

  const processBatch = async (batchIndex: number) => {
    const batch = uniqueItemsToEvaluate.slice(batchIndex * BATCH_SIZE, (batchIndex + 1) * BATCH_SIZE);
    
    const prompt = `
당신은 사방넷(Sabangnet) 매핑 검수 AI입니다.
당신의 임무는 V행(사이트수집상품명), P행(옵션명), S행(주문수량)의 정보를 바탕으로 G행(품목명)이 올바르게 매핑되었는지 검수하는 것입니다.

[학습된 정상 매핑 규칙 데이터 (최대 200개)]
아래는 정상적으로 매핑된 예시들입니다. 이 예시들을 통해 매핑의 "패턴"과 "규칙"을 학습하세요.
${JSON.stringify(sampleRules)}

[검수 가이드라인]
1. 핵심 상품명 일치 여부:
   - V행(사이트수집상품명)과 P행(옵션명)의 핵심 상품명이 G행(품목명)과 의미상 일치하는지 확인하세요.
   - 띄어쓰기, 특수문자 표기 차이(예: "매트&amp;하드" vs "매트&하드"), 단순 오탈자, 불필요한 수식어 누락 등은 정상(isCorrect: true)으로 간주하세요.
2. 수량 및 옵션 검증:
   - P행(옵션명)의 수량 정보와 S행(주문수량)을 종합하여 G행(품목명)에 표기된 수량(보통 대괄호 [ ] 안의 숫자)과 일치하는지 확인하세요.
   - 수량이 명백하게 틀린 경우에만 오답(isCorrect: false) 처리하세요.
3. 단품 용량 및 구성 수량 불일치 (매우 중요):
   - V행/P행의 단품 용량(예: 100g, 50ml)과 구성 수량(예: 6개)이 G행의 단품 용량(예: 300g)과 구성 수량(예: [2])과 다르면 **무조건 오답(isCorrect: false)** 처리하세요.
   - 총 중량/용량이 같더라도(예: 100g 6개 = 600g, 300g 2개 = 600g) 단품 용량이 다르면 다른 상품이므로 오답입니다.
   - 증정품(예: 덴탈치약 증정 등)이 V행/P행에 명시되어 있으나 G행에 누락된 경우에도 오답 처리하세요.
4. 유연한 판단:
   - "조금이라도 애매하거나 미세하게 다른 경우" 무조건 오답 처리하지 마세요. 전체적인 맥락과 핵심 정보(상품명, 주요 옵션, 총 수량, 단품 용량)가 일치하면 정상으로 판단하세요.
   - 사람이 보기에 같은 상품이라고 판단할 수 있는 수준의 차이는 허용하세요.
5. 상세한 사유 작성:
   - 오답(isCorrect: false) 처리 시, reason 필드에 어떤 핵심 정보(상품명 불일치, 수량 오류, 단품 용량 불일치, 증정품 누락 등)가 불일치하는지 구체적으로 명시하세요.

[검수할 데이터 목록]
아래 데이터들을 평가하여 JSON 배열로 결과를 반환해주세요.
정상 매핑이면 isCorrect: true, 틀렸거나 의심스러우면 isCorrect: false와 함께 그 이유(reason)를 상세히 작성해주세요.

데이터:
${JSON.stringify(batch.map(b => ({ id: b.id, V: b.vVal, P: b.pVal, S: b.sVal, G: b.gVal })))}
`;

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3.1-pro-preview', // Use pro model for better reasoning
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.NUMBER },
                isCorrect: { type: Type.BOOLEAN },
                reason: { type: Type.STRING }
              },
              required: ['id', 'isCorrect', 'reason']
            }
          }
        }
      });

      const results = JSON.parse(response.text?.trim() || '[]');
      for (const res of results) {
        if (!res.isCorrect) {
          const item = batch.find(b => b.id === res.id);
          if (item) {
            for (const rowNum of item.rowNumbers) {
              incorrectRowNumbers.add(rowNum);
              if (res.reason) {
                rowNotes.set(rowNum, res.reason);
              }
            }
          }
        }
      }
    } catch (e: any) {
      console.error('Failed to parse batch result', e);
      throw new Error(`AI 검수 중 오류가 발생했습니다: ${e.message}`);
    }
    
    completedBatches++;
    onProgress(completedBatches, totalBatches);
  };

  const CONCURRENCY_LIMIT = 5;
  for (let i = 0; i < totalBatches; i += CONCURRENCY_LIMIT) {
    const promises = [];
    for (let j = 0; j < CONCURRENCY_LIMIT && i + j < totalBatches; j++) {
      promises.push(processBatch(i + j));
    }
    await Promise.all(promises);
  }

  // Process batch results and store incorrect rows separately
  const correctRowsData: any[] = [];
  const incorrectRowsData: { values: any, note?: string }[] = [];

  // Re-read rows to categorize them
  worksheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    if (rowNumber === 1) return; // Skip header
    
    if (incorrectRowNumbers.has(rowNumber)) {
      incorrectRowsData.push({ values: row.values, note: rowNotes.get(rowNumber) });
    } else {
      correctRowsData.push({ values: row.values });
    }
  });

  // Clear all rows except header
  for (let i = worksheet.rowCount; i > 1; i--) {
    worksheet.spliceRows(i, 1);
  }

  // Add incorrect rows first (at the top), then correct rows
  incorrectRowsData.forEach(data => {
    const newRow = worksheet.addRow(data.values);
    
    // 텍스트를 빨간색으로 변경 (셀 배경색 아님)
    newRow.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = {
        ...(cell.font || {}),
        color: { argb: 'FFFF0000' }, // Red text
        bold: true
      };
    });

    const cellG = newRow.getCell('G');
    if (data.note) {
      cellG.note = data.note;
    }
  });
  
  correctRowsData.forEach(data => {
    worksheet.addRow(data.values);
  });

  // Re-apply styling to all rows
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

  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
