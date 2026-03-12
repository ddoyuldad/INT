import React, { useState, useRef } from 'react';
import { UploadCloud, FileText, Download, CheckCircle, AlertCircle, Loader2, FileSpreadsheet, Trash2, ArrowRight } from 'lucide-react';
import * as XLSX from 'xlsx';
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const DEFAULT_PROMPT = `당신은 데이터 전처리 및 변환 전문가입니다. 
제공되는 '원본 발주서' 데이터를 분석하여 '목표 양식'에 맞게 CSV 형태로 변환하는 작업을 수행해 주세요.

[데이터 변환 규칙]
1. 컬럼 매핑: 원본 데이터의 컬럼과 목표 데이터의 컬럼명은 동일합니다. 원본 데이터에서 아래 나열된 37개의 목표 컬럼만 추출하여 데이터를 매핑하세요.
2. 컬럼 순서: 반드시 아래 나열된 순서대로 컬럼을 배치해야 합니다.
3. 삭제 처리: 아래 목록에 없는 원본 데이터의 컬럼(예: 플랫폼구분, 주문구분, 예약주문, 결제수단 등 10개)은 무시하고 삭제하세요.
4. 데이터 값: 원본 데이터의 값, 특수기호(예: -), 띄어쓰기 등은 일체 수정하지 말고 그대로 복사(Copy & Paste) 하세요.
5. 데이터 형식: 
   - 주문번호(C열), 상품번호(H열)는 반드시 숫자만 남기세요 (따옴표나 문자 제거).
   - 주문일시(AE열), 결제일시(AF열), 주문접수일시(AG열)는 반드시 날짜 형식(YYYY-MM-DD HH:mm:ss)으로 변환하세요.

[목표 양식 컬럼 목록 및 순서]
1. 쇼핑몰구분
2. 배송구분
3. 주문번호
4. 주문자명
5. 주문자연락처
6. 교환여부
7. 주문메모
8. 상품번호
9. HS CODE
10. 상품관리코드
11. 상품명
12. 영문상품명
13. 옵션관리코드
14. 옵션명:옵션값
15. 구매자작성형
16. 수량
17. 판매가(할인적용가)
18. 배송메모
19. 수령자명
20. 수령자연락처
21. 우편번호
22. 주소
23. 배송번호
24. 개인통관고유부호
25. 배송방법
26. 택배사
27. 송장번호
28. 배송비 결제방식
29. 기본배송비
30. 지역별배송비
31. 주문일시
32. 결제일시
33. 주문접수일시
34. 출고준비처리일시
35. 출고일시
36. 배송완료처리일시
37. 구매확정일시`;

export default function ShopByApp() {
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [targetFile, setTargetFile] = useState<File | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<string | null>(() => {
    const saved = localStorage.getItem('shopByPrompt');
    return saved || DEFAULT_PROMPT;
  });
  const [isTransforming, setIsTransforming] = useState(false);

  // Save prompt to localStorage whenever it changes
  React.useEffect(() => {
    if (analysisResult) {
      localStorage.setItem('shopByPrompt', analysisResult);
    }
  }, [analysisResult]);
  const [transformedCsv, setTransformedCsv] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sourceInputRef = useRef<HTMLInputElement>(null);
  const targetInputRef = useRef<HTMLInputElement>(null);

  const handleSourceUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setSourceFile(e.target.files[0]);
      setTransformedCsv(null);
    }
  };

  const handleTargetUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setTargetFile(e.target.files[0]);
      setTransformedCsv(null);
    }
  };

  const extractTextFromExcel = async (file: File, limit?: number): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = e.target?.result;
          const workbook = XLSX.read(data, { type: 'binary' });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          // Convert to CSV to keep the table structure clear for AI
          const csv = XLSX.utils.sheet_to_csv(worksheet, { strip: true });
          
          if (limit) {
            // Limit the length to avoid token limits, usually headers and a few rows are enough
            const lines = csv.split('\n').slice(0, limit).join('\n');
            resolve(lines);
          } else {
            resolve(csv);
          }
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = (err) => reject(err);
      reader.readAsBinaryString(file);
    });
  };

  const handleAnalyze = async () => {
    if (!sourceFile || !targetFile) return;
    
    setIsAnalyzing(true);
    setError(null);
    setAnalysisResult(null);
    setTransformedCsv(null);

    try {
      const sourceCsv = await extractTextFromExcel(sourceFile, 20);
      const targetCsv = await extractTextFromExcel(targetFile, 20);

      const prompt = `
당신은 데이터 매핑 전문가입니다.
두 개의 엑셀 파일 데이터(CSV 형식)가 제공됩니다. 첫 번째는 '원본 발주서(A)'이고, 두 번째는 변환해야 할 '목표 양식(B)'입니다.
두 문서 모두 표(테이블) 형태의 데이터를 포함하고 있으며, 행 이름(컬럼 헤더)은 유사하거나 동일한 의미를 가질 수 있습니다.

원본 발주서(A) 데이터 샘플:
\`\`\`csv
${sourceCsv}
\`\`\`

목표 양식(B) 데이터 샘플:
\`\`\`csv
${targetCsv}
\`\`\`

당신의 임무는 원본 발주서(A)의 각 컬럼이 목표 양식(B)의 어느 컬럼과 매칭되어야 하는지 분석하여, 
데이터 변환 작업을 수행할 AI에게 전달할 '프롬프트'를 작성하는 것입니다.

분석 결과는 다음 형식을 따라주세요:

1. **컬럼 매핑 분석 결과**:
   - 원본 컬럼명 -> 목표 컬럼명 (매칭 이유)
   - ...

2. **데이터 변환 AI 프롬프트**:
   (이 부분은 다른 AI가 이 매핑 규칙을 보고 실제 데이터를 변환할 때 사용할 수 있도록 명확하고 구체적인 지시사항으로 작성해주세요. 
   예: "제공된 원본 데이터의 '수취인명'은 '받는사람' 컬럼으로 이동하세요...")
`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.1-pro-preview',
        contents: prompt
      });

      setAnalysisResult(response.text || "분석 결과를 생성하지 못했습니다.");

    } catch (err: any) {
      console.error("Analysis error:", err);
      setError(err.message || "분석 중 오류가 발생했습니다.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleTransform = async () => {
    if (!sourceFile || !analysisResult) return;
    setIsTransforming(true);
    setError(null);
    try {
      const fullCsv = await extractTextFromExcel(sourceFile);
      const prompt = `
당신은 데이터 변환 AI입니다.
다음은 데이터 매핑 및 변환 지시사항입니다:
${analysisResult}

위 지시사항을 엄격하게 적용하여, 아래 제공된 원본 CSV 데이터를 변환해주세요.
결과는 반드시 순수한 CSV 형식의 텍스트로만 출력해야 합니다. (마크다운 백틱이나 추가 설명 절대 금지)

원본 데이터:
${fullCsv}
`;
      const response = await ai.models.generateContent({
        model: 'gemini-3.1-flash-preview',
        contents: prompt
      });
      
      let resultText = response.text || "";
      // Remove markdown code blocks if AI included them despite instructions
      resultText = resultText.replace(/^```csv\n?/i, '').replace(/\n?```$/i, '').trim();
      
      setTransformedCsv(resultText);
    } catch (err: any) {
      console.error("Transform error:", err);
      setError(err.message || "데이터 변환 중 오류가 발생했습니다.");
    } finally {
      setIsTransforming(false);
    }
  };

  const downloadExcel = () => {
    if (!transformedCsv) return;
    
    // Parse CSV string to workbook
    const workbook = XLSX.read(transformedCsv, { type: 'string', raw: true });
    
    // Process the first sheet to set correct data types
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    
    if (sheet['!ref']) {
      const range = XLSX.utils.decode_range(sheet['!ref']);
      
      for (let R = 1; R <= range.e.r; ++R) { // Skip header row
        // Column C (index 2) - 주문번호
        const cellC = sheet[XLSX.utils.encode_cell({c: 2, r: R})];
        if (cellC && cellC.v !== undefined && cellC.v !== '') {
          const num = Number(cellC.v);
          if (!isNaN(num)) {
            cellC.t = 'n';
            cellC.v = num;
            cellC.z = '0'; // Number format
          }
        }
        
        // Column H (index 7) - 상품번호
        const cellH = sheet[XLSX.utils.encode_cell({c: 7, r: R})];
        if (cellH && cellH.v !== undefined && cellH.v !== '') {
          const num = Number(cellH.v);
          if (!isNaN(num)) {
            cellH.t = 'n';
            cellH.v = num;
            cellH.z = '0'; // Number format
          }
        }
        
        // Columns AE (30), AF (31), AG (32) - 날짜
        const dateCols = [30, 31, 32];
        for (const col of dateCols) {
          const cell = sheet[XLSX.utils.encode_cell({c: col, r: R})];
          if (cell && cell.v !== undefined && cell.v !== '') {
            const dateStr = String(cell.v).trim();
            const date = new Date(dateStr);
            if (!isNaN(date.getTime())) {
              cell.t = 'd';
              cell.v = date;
              cell.z = 'yyyy-mm-dd hh:mm:ss';
            }
          }
        }
      }
    }
    
    // Ensure the output file has an .xlsx extension
    const originalName = sourceFile?.name || 'data';
    const baseName = originalName.replace(/\.[^/.]+$/, ""); // Remove original extension
    const fileName = `transformed_${baseName}.xlsx`;
    
    // Write to file as Excel
    XLSX.writeFile(workbook, fileName);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      <header className="bg-white border-b border-slate-200 py-6 px-8 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-emerald-600 p-2 rounded-lg text-white">
              <FileSpreadsheet size={24} />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">SHOP BY 발주서 매핑 분석</h1>
              <p className="text-sm text-slate-500">원본 발주서와 변환할 양식 엑셀 파일을 업로드하면 컬럼 매핑 프롬프트를 생성합니다.</p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto py-8 px-8 flex flex-col gap-8">
        <section className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
          <div className="p-6 border-b border-slate-100 bg-slate-50/50">
            <div className="flex items-center gap-3 mb-1">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 font-bold text-xs">1</span>
              <h2 className="text-lg font-semibold">비교할 엑셀 파일 업로드</h2>
            </div>
            <p className="text-sm text-slate-500 ml-9">원본 파일(A)과 변환 목표 파일(B)을 각각 업로드해주세요.</p>
          </div>
          
          <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Source File Upload */}
            <div className="flex flex-col">
              <h3 className="text-sm font-medium text-slate-700 mb-3 flex items-center gap-2">
                <span className="bg-slate-200 text-slate-700 px-2 py-0.5 rounded text-xs">A</span>
                원본 발주서 엑셀
              </h3>
              <div 
                className={`border-2 border-dashed rounded-xl p-6 text-center transition-colors cursor-pointer flex-1 flex flex-col items-center justify-center ${
                  sourceFile ? 'border-emerald-400 bg-emerald-50' : 'border-slate-300 hover:bg-slate-50'
                }`}
                onClick={() => sourceInputRef.current?.click()}
              >
                {sourceFile ? (
                  <>
                    <FileText className="text-emerald-500 mb-2" size={32} />
                    <p className="text-sm font-medium text-emerald-700 truncate max-w-[200px]">{sourceFile.name}</p>
                    <button 
                      onClick={(e) => { e.stopPropagation(); setSourceFile(null); }}
                      className="mt-2 text-xs text-slate-500 hover:text-red-500 flex items-center gap-1"
                    >
                      <Trash2 size={14} /> 삭제
                    </button>
                  </>
                ) : (
                  <>
                    <UploadCloud className="text-slate-400 mb-2" size={32} />
                    <p className="text-sm font-medium text-slate-700">클릭하여 파일 선택</p>
                  </>
                )}
                <input 
                  type="file" 
                  accept=".xlsx, .xls, .csv" 
                  className="hidden" 
                  ref={sourceInputRef}
                  onChange={handleSourceUpload}
                />
              </div>
            </div>

            {/* Target File Upload */}
            <div className="flex flex-col">
              <h3 className="text-sm font-medium text-slate-700 mb-3 flex items-center gap-2">
                <span className="bg-slate-200 text-slate-700 px-2 py-0.5 rounded text-xs">B</span>
                변환 목표 양식 엑셀 (선택)
              </h3>
              <div 
                className={`border-2 border-dashed rounded-xl p-6 text-center transition-colors cursor-pointer flex-1 flex flex-col items-center justify-center ${
                  targetFile ? 'border-emerald-400 bg-emerald-50' : 'border-slate-300 hover:bg-slate-50'
                }`}
                onClick={() => targetInputRef.current?.click()}
              >
                {targetFile ? (
                  <>
                    <FileText className="text-emerald-500 mb-2" size={32} />
                    <p className="text-sm font-medium text-emerald-700 truncate max-w-[200px]">{targetFile.name}</p>
                    <button 
                      onClick={(e) => { e.stopPropagation(); setTargetFile(null); }}
                      className="mt-2 text-xs text-slate-500 hover:text-red-500 flex items-center gap-1"
                    >
                      <Trash2 size={14} /> 삭제
                    </button>
                  </>
                ) : (
                  <>
                    <UploadCloud className="text-slate-400 mb-2" size={32} />
                    <p className="text-sm font-medium text-slate-700">클릭하여 파일 선택</p>
                    <p className="text-xs text-slate-500 mt-2">이미 프롬프트가 있다면 생략 가능</p>
                  </>
                )}
                <input 
                  type="file" 
                  accept=".xlsx, .xls, .csv" 
                  className="hidden" 
                  ref={targetInputRef}
                  onChange={handleTargetUpload}
                />
              </div>
            </div>
          </div>

          <div className="p-6 pt-0 flex flex-col sm:flex-row gap-4">
            <button
              onClick={handleAnalyze}
              disabled={!sourceFile || !targetFile || isAnalyzing}
              className="flex-1 py-3 px-4 bg-slate-800 hover:bg-slate-900 disabled:bg-slate-300 disabled:cursor-not-allowed text-white rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
            >
              {isAnalyzing ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  <span>AI가 컬럼 구조를 분석 중입니다...</span>
                </>
              ) : (
                <>
                  <CheckCircle size={18} />
                  <span>매핑 분석 및 프롬프트 생성</span>
                </>
              )}
            </button>
            <button
              onClick={handleTransform}
              disabled={!sourceFile || !analysisResult || isTransforming}
              className="flex-1 py-3 px-4 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
            >
              {isTransforming ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  <span>변환 중...</span>
                </>
              ) : (
                <>
                  <ArrowRight size={18} />
                  <span>AI 자동 변환 실행</span>
                </>
              )}
            </button>
          </div>
          
          {error && (
            <div className="px-6 pb-6">
              <div className="p-3 bg-red-50 text-red-700 text-sm rounded-lg flex items-start gap-2">
                <AlertCircle size={16} className="shrink-0 mt-0.5" />
                <p>{error}</p>
              </div>
            </div>
          )}
        </section>

        {analysisResult && (
          <section className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-6 border-b border-slate-100 bg-slate-50/50">
              <div className="flex items-center gap-3 mb-1">
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 font-bold text-xs">2</span>
                <h2 className="text-lg font-semibold">AI 분석 결과 및 프롬프트</h2>
              </div>
              <p className="text-sm text-slate-500 ml-9">이 프롬프트는 원본 발주서만 업로드해도 자동 변환에 사용됩니다.</p>
            </div>
            <div className="p-6">
              <textarea
                value={analysisResult}
                onChange={(e) => setAnalysisResult(e.target.value)}
                className="w-full h-64 bg-slate-50 border border-slate-200 rounded-xl p-6 font-mono text-sm text-slate-800 leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-emerald-500"
                placeholder="여기에 매핑 프롬프트를 입력하거나 수정할 수 있습니다."
              />
              <div className="mt-4 flex justify-end">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(analysisResult);
                    alert("프롬프트가 클립보드에 복사되었습니다.");
                  }}
                  className="px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg text-sm font-medium transition-colors"
                >
                  프롬프트 복사
                </button>
              </div>
            </div>
          </section>
        )}

        {transformedCsv && (
          <section className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
              <div className="flex items-center gap-3">
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 font-bold text-xs">3</span>
                <h2 className="text-lg font-semibold">변환 완료</h2>
              </div>
              <button
                onClick={downloadExcel}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
              >
                <Download size={16} />
                엑셀 파일 다운로드
              </button>
            </div>
            <div className="p-6">
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <tbody>
                    {transformedCsv.split('\n').slice(0, 5).map((line, i) => (
                      <tr key={i} className="border-b border-slate-200 last:border-0">
                        {line.split(',').map((cell, j) => (
                          <td key={j} className="p-2 whitespace-nowrap">{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {transformedCsv.split('\n').length > 5 && (
                  <p className="text-center text-xs text-slate-400 mt-4">... 외 {transformedCsv.split('\n').length - 5}개 행</p>
                )}
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
