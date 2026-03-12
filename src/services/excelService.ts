import * as XLSX from 'xlsx';
import { ProductMapping } from './geminiService';

export async function extractMappingsFromExcel(file: File): Promise<ProductMapping[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const jsonData: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        
        if (jsonData.length === 0) return resolve([]);

        let productNameColIndex = -1;
        let productCodeColIndex = -1;

        // Find header row
        for (let i = 0; i < Math.min(10, jsonData.length); i++) {
          const row = jsonData[i];
          if (!row) continue;
          for (let j = 0; j < row.length; j++) {
            const cellValue = String(row[j] || '').trim();
            if (cellValue.includes('주문상품명') || cellValue === '상품명') productNameColIndex = j;
            if (cellValue.includes('상품코드') || cellValue === '사방넷상품코드') productCodeColIndex = j;
          }
          if (productNameColIndex !== -1 && productCodeColIndex !== -1) break;
        }

        if (productNameColIndex === -1 || productCodeColIndex === -1) {
          return resolve([]);
        }

        const mappings: ProductMapping[] = [];
        for (let i = 1; i < jsonData.length; i++) {
          const row = jsonData[i];
          if (!row) continue;
          const name = String(row[productNameColIndex] || '').trim();
          const code = String(row[productCodeColIndex] || '').trim();
          if (name && code) {
            mappings.push({ productName: name, productCode: code });
          }
        }
        resolve(mappings);
      } catch (error) {
        reject(error);
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

export async function processExcelFile(file: File, mappings: ProductMapping[]): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        
        // Process the first sheet
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        // Convert to JSON (array of arrays) to easily find headers and modify data
        const jsonData: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        
        if (jsonData.length === 0) {
          throw new Error("Excel file is empty");
        }

        // Find header row (assuming it's within the first 10 rows)
        let headerRowIndex = -1;
        let productNameColIndex = -1;
        let productCodeColIndex = -1;

        for (let i = 0; i < Math.min(10, jsonData.length); i++) {
          const row = jsonData[i];
          if (!row) continue;
          
          for (let j = 0; j < row.length; j++) {
            const cellValue = String(row[j] || '').trim();
            if (cellValue.includes('주문상품명') || cellValue === '상품명') {
              headerRowIndex = i;
              productNameColIndex = j;
            }
            if (cellValue.includes('상품코드') || cellValue === '사방넷상품코드') {
              productCodeColIndex = j;
            }
          }
          
          if (headerRowIndex !== -1) break;
        }

        if (headerRowIndex === -1 || productNameColIndex === -1) {
          throw new Error("Could not find '주문상품명' column in the Excel file.");
        }

        // If '상품코드' column doesn't exist, add it to the end
        if (productCodeColIndex === -1) {
          productCodeColIndex = jsonData[headerRowIndex].length;
          jsonData[headerRowIndex][productCodeColIndex] = '상품코드';
        }

        // Create a lookup map for faster matching
        // Let's do a simple exact match first, or partial match if needed
        const mappingDict: Record<string, string> = {};
        mappings.forEach(m => {
          mappingDict[m.productName.trim()] = m.productCode;
        });

        // Process rows below the header
        let matchedCount = 0;
        for (let i = headerRowIndex + 1; i < jsonData.length; i++) {
          const row = jsonData[i];
          if (!row || row.length === 0) continue;
          
          const productName = String(row[productNameColIndex] || '').trim();
          if (productName) {
            // Try exact match
            let matchedCode = mappingDict[productName];
            
            // If no exact match, try finding if the mapping name is contained in the product name
            if (!matchedCode) {
              const matchedMapping = mappings.find(m => productName.includes(m.productName.trim()));
              if (matchedMapping) {
                matchedCode = matchedMapping.productCode;
              }
            }

            if (matchedCode) {
              row[productCodeColIndex] = matchedCode;
              matchedCount++;
            }
          }
        }

        console.log(`Matched ${matchedCount} products.`);

        // Convert back to worksheet
        const newWorksheet = XLSX.utils.aoa_to_sheet(jsonData);
        workbook.Sheets[firstSheetName] = newWorksheet;

        // Write to buffer
        const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
        const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        resolve(blob);
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = (error) => reject(error);
    reader.readAsArrayBuffer(file);
  });
}
