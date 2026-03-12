import React, { useState, useRef, useEffect } from 'react';
import { UploadCloud, FileText, Download, CheckCircle, AlertCircle, Loader2, FileSpreadsheet, Trash2, Save, Upload } from 'lucide-react';
import { PDFDocument } from 'pdf-lib';
import { extractMappingsFromPdfDoc, ProductMapping, CHUNK_SIZE } from '../services/geminiService';
import { processExcelFile, extractMappingsFromExcel } from '../services/excelService';

export default function SabangnetApp() {
  const [pdfFiles, setPdfFiles] = useState<File[]>([]);
  const [mappings, setMappings] = useState<ProductMapping[]>(() => {
    const saved = localStorage.getItem('productMappings');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        return [];
      }
    }
    return [];
  });
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  const [targetFile, setTargetFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processError, setProcessError] = useState<string | null>(null);
  const [processedBlob, setProcessedBlob] = useState<Blob | null>(null);

  const pdfInputRef = useRef<HTMLInputElement>(null);
  const excelInputRef = useRef<HTMLInputElement>(null);
  const excelTrainingInputRef = useRef<HTMLInputElement>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);

  // Save mappings to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem('productMappings', JSON.stringify(mappings));
  }, [mappings]);

  const handleExportJson = () => {
    if (mappings.length === 0) return;
    const dataStr = JSON.stringify(mappings, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `product_mappings_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleImportJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const imported = JSON.parse(event.target?.result as string);
        if (Array.isArray(imported)) {
          // Validate structure
          const isValid = imported.every(item => 
            item && typeof item === 'object' && 'productName' in item && 'productCode' in item
          );
          
          if (!isValid) {
            alert('올바른 상품코드 매핑 JSON 파일이 아닙니다. (productName, productCode 필드 필요)');
            return;
          }

          // Merge with existing or replace? Let's merge and deduplicate
          const merged = [...mappings, ...imported];
          const unique = Array.from(new Map(merged.map(m => [m.productName, m])).values());
          setMappings(unique);
          alert(`${imported.length}개의 매핑 데이터를 불러왔습니다.`);
        } else {
          alert('올바른 JSON 형식이 아닙니다. 배열 형태여야 합니다.');
        }
      } catch (err) {
        alert('파일을 읽는 중 오류가 발생했습니다.');
      }
    };
    reader.readAsText(file);
    // Reset input
    if (jsonInputRef.current) {
      jsonInputRef.current.value = '';
    }
  };

  const handlePdfUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setPdfFiles(prev => [...prev, ...Array.from(e.target.files!)]);
    }
  };

  const handleExcelTrainingUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsExtracting(true);
    setExtractError(null);
    try {
      const extracted = await extractMappingsFromExcel(file);
      if (extracted.length === 0) {
        throw new Error("엑셀 파일에서 유효한 매핑 데이터를 찾을 수 없습니다. '주문상품명'과 '상품코드' 열이 있는지 확인해주세요.");
      }
      
      const merged = [...mappings, ...extracted];
      const unique = Array.from(new Map(merged.map(m => [m.productName, m])).values());
      setMappings(unique);
      alert(`${extracted.length}개의 매핑 데이터를 엑셀에서 학습했습니다.`);
    } catch (error: any) {
      setExtractError(error.message || "엑셀 분석 중 오류가 발생했습니다.");
    } finally {
      setIsExtracting(false);
      e.target.value = '';
    }
  };

  const removePdf = (index: number) => {
    setPdfFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleExtractMappings = async () => {
    if (pdfFiles.length === 0) return;
    
    setIsExtracting(true);
    setExtractError(null);
    setProgress({ current: 0, total: 0 });
    
    try {
      let totalChunks = 0;
      const loadedDocs: PDFDocument[] = [];
      
      // 1. Load all PDFs and calculate total chunks
      for (const file of pdfFiles) {
        try {
          const arrayBuffer = await file.arrayBuffer();
          const pdfDoc = await PDFDocument.load(arrayBuffer);
          const chunks = Math.ceil(pdfDoc.getPageCount() / CHUNK_SIZE);
          totalChunks += chunks;
          loadedDocs.push(pdfDoc);
        } catch (e) {
          throw new Error(`'${file.name}' 파일을 읽을 수 없습니다. 암호가 걸려있거나 손상된 파일인지 확인 후 제외하고 다시 업로드해주세요.`);
        }
      }

      setProgress({ current: 0, total: totalChunks });

      let allMappings: ProductMapping[] = [...mappings]; // Keep existing mappings
      let currentCompleted = 0;
      
      // 2. Process each PDF document
      for (const pdfDoc of loadedDocs) {
        const extracted = await extractMappingsFromPdfDoc(pdfDoc, () => {
          currentCompleted++;
          setProgress({ current: currentCompleted, total: totalChunks });
        });
        allMappings = [...allMappings, ...extracted];
      }
      
      // Deduplicate mappings based on product name
      const uniqueMappings = Array.from(new Map(allMappings.map(m => [m.productName, m])).values());
      setMappings(uniqueMappings);
      setPdfFiles([]); // Clear uploaded PDFs after successful extraction
    } catch (error: any) {
      setExtractError(error.message || "알 수 없는 오류가 발생했습니다. 새로고침 후 다시 시도해주세요.");
    } finally {
      setIsExtracting(false);
    }
  };

  const handleClearMappings = () => {
    if (window.confirm('저장된 모든 상품코드 매핑 데이터를 삭제하시겠습니까?')) {
      setMappings([]);
      localStorage.removeItem('productMappings');
    }
  };

  const handleExcelUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setTargetFile(e.target.files[0]);
      setProcessedBlob(null);
      setProcessError(null);
    }
  };

  const handleProcessExcel = async () => {
    if (!targetFile || mappings.length === 0) return;
    
    setIsProcessing(true);
    setProcessError(null);
    
    try {
      const blob = await processExcelFile(targetFile, mappings);
      setProcessedBlob(blob);
    } catch (error: any) {
      setProcessError(error.message || "Failed to process the Excel file.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownload = () => {
    if (!processedBlob || !targetFile) return;
    
    const url = URL.createObjectURL(processedBlob);
    const a = document.createElement('a');
    a.href = url;
    // Append _matched to the original filename
    const fileNameParts = targetFile.name.split('.');
    const ext = fileNameParts.pop();
    const baseName = fileNameParts.join('.');
    a.download = `${baseName}_matched.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      <header className="bg-white border-b border-slate-200 py-6 px-8 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-600 p-2 rounded-lg text-white">
              <FileSpreadsheet size={24} />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">공구 코드 매칭 프로그램</h1>
              <p className="text-sm text-slate-500">PDF에서 상품코드를 학습하고 엑셀 파일에 자동으로 매칭합니다.</p>
            </div>
          </div>
          {mappings.length > 0 && (
            <div className="flex items-center gap-2 bg-emerald-50 text-emerald-700 px-3 py-1.5 rounded-full text-sm font-medium border border-emerald-200">
              <Save size={16} />
              <span>{mappings.length}개 데이터 저장됨</span>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-5xl mx-auto py-8 px-8 grid grid-cols-1 lg:grid-cols-2 gap-8">
        
        {/* Step 1: Learning from PDFs */}
        <section className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
          <div className="p-6 border-b border-slate-100 bg-slate-50/50">
            <div className="flex items-center gap-3 mb-1">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 font-bold text-xs">1</span>
              <h2 className="text-lg font-semibold">학습 데이터 추가 (PDF/Excel/JSON)</h2>
            </div>
            <p className="text-sm text-slate-500 ml-9">상품명과 상품코드가 포함된 PDF, 엑셀 또는 백업된 JSON 파일을 업로드합니다.</p>
          </div>
          
          <div className="p-6 flex-1 flex flex-col">
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div 
                className="border-2 border-dashed border-slate-300 rounded-xl p-4 text-center hover:bg-slate-50 transition-colors cursor-pointer flex flex-col items-center justify-center"
                onClick={() => pdfInputRef.current?.click()}
              >
                <UploadCloud className="text-slate-400 mb-2" size={24} />
                <p className="text-xs font-medium text-slate-700">PDF로 학습</p>
                <input 
                  type="file" 
                  multiple 
                  accept=".pdf" 
                  className="hidden" 
                  ref={pdfInputRef}
                  onChange={handlePdfUpload}
                />
              </div>
              <div 
                className="border-2 border-dashed border-slate-300 rounded-xl p-4 text-center hover:bg-slate-50 transition-colors cursor-pointer flex flex-col items-center justify-center"
                onClick={() => excelTrainingInputRef.current?.click()}
              >
                <FileSpreadsheet className="text-slate-400 mb-2" size={24} />
                <p className="text-xs font-medium text-slate-700">엑셀로 학습</p>
                <input 
                  type="file" 
                  accept=".xlsx, .xls, .csv" 
                  className="hidden" 
                  ref={excelTrainingInputRef}
                  onChange={handleExcelTrainingUpload}
                />
              </div>
              <div 
                className="border-2 border-dashed border-emerald-300 rounded-xl p-4 text-center hover:bg-emerald-50 transition-colors cursor-pointer flex flex-col items-center justify-center bg-emerald-50/30"
                onClick={() => jsonInputRef.current?.click()}
              >
                <Upload className="text-emerald-500 mb-2" size={24} />
                <p className="text-xs font-medium text-emerald-700">JSON 불러오기</p>
              </div>
            </div>

            {pdfFiles.length > 0 && (
              <div className="mb-6">
                <h3 className="text-sm font-medium text-slate-700 mb-2">업로드된 파일 ({pdfFiles.length})</h3>
                <ul className="space-y-2 max-h-40 overflow-y-auto pr-2">
                  {pdfFiles.map((file, idx) => (
                    <li key={idx} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-100">
                      <div className="flex items-center gap-3 overflow-hidden">
                        <FileText size={16} className="text-indigo-500 shrink-0" />
                        <span className="text-sm text-slate-700 truncate">{file.name}</span>
                      </div>
                      <button 
                        onClick={() => removePdf(idx)}
                        className="text-slate-400 hover:text-red-500 p-1 rounded-md transition-colors"
                      >
                        <Trash2 size={16} />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-auto pt-4 border-t border-slate-100">
              <button
                onClick={handleExtractMappings}
                disabled={pdfFiles.length === 0 || isExtracting}
                className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
              >
                {isExtracting ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    <span>PDF 분석 및 학습 중...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle size={18} />
                    <span>상품코드 추가 학습하기</span>
                  </>
                )}
              </button>
              
              {isExtracting && progress.total > 0 && (
                <div className="mt-4 p-4 bg-indigo-50 rounded-xl border border-indigo-100">
                  <div className="flex justify-between text-xs font-medium text-indigo-700 mb-2">
                    <span>분석 진행률</span>
                    <span>{Math.round((progress.current / progress.total) * 100)}% ({progress.current}/{progress.total} 완료)</span>
                  </div>
                  <div className="w-full bg-indigo-200/50 rounded-full h-2.5 overflow-hidden">
                    <div 
                      className="bg-indigo-600 h-2.5 rounded-full transition-all duration-500 ease-out" 
                      style={{ width: `${(progress.current / progress.total) * 100}%` }}
                    ></div>
                  </div>
                  <p className="text-xs text-indigo-500 mt-2 text-center">
                    파일 크기에 따라 수 분이 소요될 수 있습니다. 창을 닫지 마세요.
                  </p>
                </div>
              )}

              {extractError && (
                <div className="mt-3 p-3 bg-red-50 text-red-700 text-sm rounded-lg flex items-start gap-2">
                  <AlertCircle size={16} className="shrink-0 mt-0.5" />
                  <p>{extractError}</p>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Step 2: Matching Excel */}
        <section className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
          <div className="p-6 border-b border-slate-100 bg-slate-50/50">
            <div className="flex items-center gap-3 mb-1">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 font-bold text-xs">2</span>
              <h2 className="text-lg font-semibold">공구 엑셀 매칭</h2>
            </div>
            <p className="text-sm text-slate-500 ml-9">상품코드가 비어있는 공구 엑셀 파일을 업로드하여 코드를 채웁니다.</p>
          </div>
          
          <div className="p-6 flex-1 flex flex-col">
            <div 
              className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors mb-4 ${
                mappings.length === 0 
                  ? 'border-slate-200 bg-slate-50 opacity-60 cursor-not-allowed' 
                  : 'border-emerald-300 hover:bg-emerald-50 cursor-pointer'
              }`}
              onClick={() => mappings.length > 0 && excelInputRef.current?.click()}
            >
              <FileSpreadsheet className={`mx-auto mb-3 ${mappings.length === 0 ? 'text-slate-300' : 'text-emerald-500'}`} size={32} />
              <p className="text-sm font-medium text-slate-700">대상 엑셀 파일 업로드</p>
              <p className="text-xs text-slate-500 mt-1">
                {mappings.length === 0 ? '먼저 1단계에서 학습을 완료해주세요.' : '클릭하여 엑셀(.xlsx, .csv) 파일을 선택하세요.'}
              </p>
              <input 
                type="file" 
                accept=".xlsx, .xls, .csv" 
                className="hidden" 
                ref={excelInputRef}
                onChange={handleExcelUpload}
                disabled={mappings.length === 0}
              />
            </div>

            {targetFile && (
              <div className="mb-6 p-4 bg-emerald-50 rounded-xl border border-emerald-100 flex items-center justify-between">
                <div className="flex items-center gap-3 overflow-hidden">
                  <FileSpreadsheet size={20} className="text-emerald-600 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-emerald-900 truncate">{targetFile.name}</p>
                    <p className="text-xs text-emerald-700">{(targetFile.size / 1024).toFixed(1)} KB</p>
                  </div>
                </div>
              </div>
            )}

            <div className="mt-auto pt-4 border-t border-slate-100 space-y-3">
              <button
                onClick={handleProcessExcel}
                disabled={!targetFile || mappings.length === 0 || isProcessing}
                className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
              >
                {isProcessing ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    <span>엑셀 매칭 처리 중...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle size={18} />
                    <span>상품코드 매칭 실행</span>
                  </>
                )}
              </button>

              {processError && (
                <div className="p-3 bg-red-50 text-red-700 text-sm rounded-lg flex items-start gap-2">
                  <AlertCircle size={16} className="shrink-0 mt-0.5" />
                  <p>{processError}</p>
                </div>
              )}

              {processedBlob && (
                <button
                  onClick={handleDownload}
                  className="w-full py-3 px-4 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
                >
                  <Download size={18} />
                  <span>완료된 파일 다운로드</span>
                </button>
              )}
            </div>
          </div>
        </section>

        {/* Extracted Mappings Table */}
          <section className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">저장된 상품코드 매핑 목록</h2>
                <p className="text-sm text-slate-500">
                  {mappings.length > 0 
                    ? `총 ${mappings.length}개의 상품코드가 브라우저에 저장되어 있습니다.`
                    : '저장된 상품코드가 없습니다. PDF/엑셀로 학습하거나 JSON 파일을 불러오세요.'}
                </p>
              </div>
              {mappings.length > 0 && (
                <button
                  onClick={handleClearMappings}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                >
                  <Trash2 size={16} />
                  <span>전체 삭제</span>
                </button>
              )}
            </div>
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-100 flex gap-3">
              <button
                onClick={handleExportJson}
                disabled={mappings.length === 0}
                className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Download size={16} className="text-indigo-600" />
                <span>JSON으로 내보내기 (백업)</span>
              </button>
              <button
                onClick={() => jsonInputRef.current?.click()}
                className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors shadow-sm"
              >
                <Upload size={16} className="text-emerald-600" />
                <span>JSON 불러오기 (복원)</span>
              </button>
              <input 
                type="file" 
                accept=".json" 
                className="hidden" 
                ref={jsonInputRef}
                onChange={handleImportJson}
              />
            </div>
            {mappings.length > 0 ? (
              <div className="overflow-x-auto max-h-96">
                <table className="w-full text-sm text-left">
                  <thead className="text-xs text-slate-500 uppercase bg-slate-50 sticky top-0">
                    <tr>
                      <th className="px-6 py-3 font-medium">주문상품명</th>
                      <th className="px-6 py-3 font-medium w-48">상품코드</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {mappings.map((mapping, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/50">
                        <td className="px-6 py-3 font-medium text-slate-900">{mapping.productName}</td>
                        <td className="px-6 py-3 text-slate-600 font-mono">{mapping.productCode}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-12 text-center flex flex-col items-center justify-center bg-slate-50/50">
                <FileText className="text-slate-300 mb-3" size={48} />
                <p className="text-slate-500 font-medium">저장된 매핑 데이터가 없습니다</p>
                <p className="text-slate-400 text-sm mt-1">위의 'JSON 불러오기' 버튼을 클릭하여 백업된 데이터를 복원하세요.</p>
              </div>
            )}
          </section>
      </main>
    </div>
  );
}
