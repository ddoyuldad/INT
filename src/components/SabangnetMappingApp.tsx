import React, { useState, useRef, useEffect } from 'react';
import { UploadCloud, FileText, Download, CheckCircle, AlertCircle, Loader2, FileSpreadsheet, Trash2, Save, FileSearch, Upload } from 'lucide-react';
import { PDFDocument } from 'pdf-lib';
import { extractMappingRulesFromPdfDoc, MappingRule, CHUNK_SIZE, processMappingExcelFile, extractMappingRulesFromExcel } from '../services/mappingService';

export default function SabangnetMappingApp() {
  const [pdfFiles, setPdfFiles] = useState<File[]>([]);
  const [rules, setRules] = useState<MappingRule[]>(() => {
    const saved = localStorage.getItem('mappingRules');
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
  const [processProgress, setProcessProgress] = useState({ current: 0, total: 0 });

  const pdfInputRef = useRef<HTMLInputElement>(null);
  const excelInputRef = useRef<HTMLInputElement>(null);
  const excelTrainingInputRef = useRef<HTMLInputElement>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    localStorage.setItem('mappingRules', JSON.stringify(rules));
  }, [rules]);

  const handleExportJson = () => {
    if (rules.length === 0) return;
    const dataStr = JSON.stringify(rules, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `mapping_rules_${new Date().toISOString().split('T')[0]}.json`;
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
            item && typeof item === 'object' && 
            'siteProductName' in item && 
            'optionName' in item && 
            'quantity' in item && 
            'mappedItemName' in item
          );
          
          if (!isValid) {
            alert('올바른 매핑 규칙 JSON 파일이 아닙니다. (siteProductName, optionName, quantity, mappedItemName 필드 필요)');
            return;
          }

          const merged = [...rules, ...imported];
          // Use a composite key for deduplication to avoid overwriting rules with the same mappedItemName
          const unique = Array.from(new Map(merged.map(m => [`${m.siteProductName}|${m.optionName}|${m.quantity}|${m.mappedItemName}`, m])).values());
          setRules(unique);
          alert(`${imported.length}개의 매핑 규칙을 불러왔습니다.`);
        } else {
          alert('올바른 JSON 형식이 아닙니다. 배열 형태여야 합니다.');
        }
      } catch (err) {
        alert('파일을 읽는 중 오류가 발생했습니다.');
      }
    };
    reader.readAsText(file);
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
      const extracted = await extractMappingRulesFromExcel(file);
      if (extracted.length === 0) {
        throw new Error("엑셀 파일에서 유효한 매핑 데이터를 찾을 수 없습니다. V, P, S, G 열이 있는지 확인해주세요.");
      }
      
      const merged = [...rules, ...extracted];
      const unique = Array.from(new Map(merged.map(m => [`${m.siteProductName}|${m.optionName}|${m.quantity}|${m.mappedItemName}`, m])).values());
      setRules(unique);
      alert(`${extracted.length}개의 매핑 규칙을 엑셀에서 학습했습니다.`);
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

  const handleExtractRules = async () => {
    if (pdfFiles.length === 0) return;
    
    setIsExtracting(true);
    setExtractError(null);
    setProgress({ current: 0, total: 0 });
    
    try {
      let totalChunks = 0;
      const loadedDocs: PDFDocument[] = [];
      
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

      let allRules: MappingRule[] = [...rules];
      let currentCompleted = 0;
      
      for (const pdfDoc of loadedDocs) {
        const extracted = await extractMappingRulesFromPdfDoc(pdfDoc, () => {
          currentCompleted++;
          setProgress({ current: currentCompleted, total: totalChunks });
        });
        allRules = [...allRules, ...extracted];
      }
      
      // Deduplicate rules based on all fields
      const uniqueRules = Array.from(new Map(allRules.map(m => [`${m.siteProductName}|${m.optionName}|${m.quantity}|${m.mappedItemName}`, m])).values());
      setRules(uniqueRules);
      setPdfFiles([]);
    } catch (error: any) {
      setExtractError(error.message || "알 수 없는 오류가 발생했습니다. 새로고침 후 다시 시도해주세요.");
    } finally {
      setIsExtracting(false);
    }
  };

  const handleClearRules = () => {
    if (window.confirm('저장된 모든 매핑 규칙을 삭제하시겠습니까?')) {
      setRules([]);
      localStorage.removeItem('mappingRules');
    }
  };

  const handleExcelUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setTargetFile(e.target.files[0]);
      setProcessedBlob(null);
      setProcessError(null);
      setProcessProgress({ current: 0, total: 0 });
    }
  };

  const handleProcessExcel = async () => {
    if (!targetFile || rules.length === 0) return;
    
    setIsProcessing(true);
    setProcessError(null);
    setProcessProgress({ current: 0, total: 0 });
    
    try {
      const blob = await processMappingExcelFile(targetFile, rules, (current, total) => {
        setProcessProgress({ current, total });
      });
      setProcessedBlob(blob);
      
      // Auto download
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const fileNameParts = targetFile.name.split('.');
      const ext = fileNameParts.pop();
      const baseName = fileNameParts.join('.');
      a.download = `${baseName}_checked.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
    } catch (error: any) {
      setProcessError(error.message || "엑셀 파일 처리 중 오류가 발생했습니다.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownload = () => {
    if (!processedBlob || !targetFile) return;
    
    const url = URL.createObjectURL(processedBlob);
    const a = document.createElement('a');
    a.href = url;
    const fileNameParts = targetFile.name.split('.');
    const ext = fileNameParts.pop();
    const baseName = fileNameParts.join('.');
    a.download = `${baseName}_checked.${ext}`;
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
            <div className="bg-rose-600 p-2 rounded-lg text-white">
              <FileSearch size={24} />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">사방넷 매핑 검수 프로그램</h1>
              <p className="text-sm text-slate-500">PDF로 매핑 규칙을 학습하고, 엑셀 파일의 매핑이 올바른지 검수합니다.</p>
            </div>
          </div>
          {rules.length > 0 && (
            <div className="flex items-center gap-2 bg-rose-50 text-rose-700 px-3 py-1.5 rounded-full text-sm font-medium border border-rose-200">
              <Save size={16} />
              <span>{rules.length}개 매핑 규칙 저장됨</span>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-5xl mx-auto py-8 px-8 grid grid-cols-1 lg:grid-cols-2 gap-8">
        
        {/* Step 1: Learning from PDFs */}
        <section className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
          <div className="p-6 border-b border-slate-100 bg-slate-50/50">
            <div className="flex items-center gap-3 mb-1">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-rose-100 text-rose-700 font-bold text-xs">1</span>
              <h2 className="text-lg font-semibold">매핑 규칙 학습 (PDF/Excel/JSON)</h2>
            </div>
            <p className="text-sm text-slate-500 ml-9">정상적으로 매핑된 PDF, 엑셀 또는 백업된 JSON 파일을 업로드하여 규칙을 학습합니다.</p>
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
                  accept=".xlsx" 
                  className="hidden" 
                  ref={excelTrainingInputRef}
                  onChange={handleExcelTrainingUpload}
                />
              </div>
              <div 
                className="border-2 border-dashed border-blue-300 rounded-xl p-4 text-center hover:bg-blue-50 transition-colors cursor-pointer flex flex-col items-center justify-center bg-blue-50/30"
                onClick={() => jsonInputRef.current?.click()}
              >
                <Upload className="text-blue-500 mb-2" size={24} />
                <p className="text-xs font-medium text-blue-700">JSON 불러오기</p>
              </div>
            </div>

            {pdfFiles.length > 0 && (
              <div className="mb-6">
                <h3 className="text-sm font-medium text-slate-700 mb-2">업로드된 파일 ({pdfFiles.length})</h3>
                <ul className="space-y-2 max-h-40 overflow-y-auto pr-2">
                  {pdfFiles.map((file, idx) => (
                    <li key={idx} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-100">
                      <div className="flex items-center gap-3 overflow-hidden">
                        <FileText size={16} className="text-rose-500 shrink-0" />
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
                onClick={handleExtractRules}
                disabled={pdfFiles.length === 0 || isExtracting}
                className="w-full py-3 px-4 bg-rose-600 hover:bg-rose-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
              >
                {isExtracting ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    <span>PDF 분석 및 학습 중...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle size={18} />
                    <span>매핑 규칙 학습하기</span>
                  </>
                )}
              </button>
              
              {isExtracting && progress.total > 0 && (
                <div className="mt-4 p-4 bg-rose-50 rounded-xl border border-rose-100">
                  <div className="flex justify-between text-xs font-medium text-rose-700 mb-2">
                    <span>분석 진행률</span>
                    <span>{Math.round((progress.current / progress.total) * 100)}% ({progress.current}/{progress.total} 완료)</span>
                  </div>
                  <div className="w-full bg-rose-200/50 rounded-full h-2.5 overflow-hidden">
                    <div 
                      className="bg-rose-600 h-2.5 rounded-full transition-all duration-500 ease-out" 
                      style={{ width: `${(progress.current / progress.total) * 100}%` }}
                    ></div>
                  </div>
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

        {/* Step 2: Checking Excel */}
        <section className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
          <div className="p-6 border-b border-slate-100 bg-slate-50/50">
            <div className="flex items-center gap-3 mb-1">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-700 font-bold text-xs">2</span>
              <h2 className="text-lg font-semibold">엑셀 매핑 검수</h2>
            </div>
            <p className="text-sm text-slate-500 ml-9">검수할 엑셀 파일을 업로드하면, 아리송한 매핑을 빨간색 셀로 표시합니다.</p>
          </div>
          
          <div className="p-6 flex-1 flex flex-col">
            <div 
              className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors mb-4 ${
                rules.length === 0 
                  ? 'border-slate-200 bg-slate-50 opacity-60 cursor-not-allowed' 
                  : 'border-blue-300 hover:bg-blue-50 cursor-pointer'
              }`}
              onClick={() => rules.length > 0 && excelInputRef.current?.click()}
            >
              <FileSpreadsheet className={`mx-auto mb-3 ${rules.length === 0 ? 'text-slate-300' : 'text-blue-500'}`} size={32} />
              <p className="text-sm font-medium text-slate-700">검수 대상 엑셀 파일 업로드</p>
              <p className="text-xs text-slate-500 mt-1">
                {rules.length === 0 ? '먼저 1단계에서 학습을 완료해주세요.' : '클릭하여 엑셀(.xlsx) 파일을 선택하세요.'}
              </p>
              <input 
                type="file" 
                accept=".xlsx" 
                className="hidden" 
                ref={excelInputRef}
                onChange={handleExcelUpload}
                disabled={rules.length === 0}
              />
            </div>

            {targetFile && (
              <div className="mb-6 p-4 bg-blue-50 rounded-xl border border-blue-100 flex items-center justify-between">
                <div className="flex items-center gap-3 overflow-hidden">
                  <FileSpreadsheet size={20} className="text-blue-600 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-blue-900 truncate">{targetFile.name}</p>
                    <p className="text-xs text-blue-700">{(targetFile.size / 1024).toFixed(1)} KB</p>
                  </div>
                </div>
              </div>
            )}

            <div className="mt-auto pt-4 border-t border-slate-100 space-y-3">
              <button
                onClick={handleProcessExcel}
                disabled={!targetFile || rules.length === 0 || isProcessing}
                className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
              >
                {isProcessing ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    <span>엑셀 검수 중...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle size={18} />
                    <span>매핑 검수 실행</span>
                  </>
                )}
              </button>

              {isProcessing && processProgress.total > 0 && (
                <div className="p-4 bg-blue-50 rounded-xl border border-blue-100">
                  <div className="flex justify-between text-xs font-medium text-blue-700 mb-2">
                    <span>검수 진행률</span>
                    <span>{Math.round((processProgress.current / processProgress.total) * 100)}% ({processProgress.current}/{processProgress.total} 완료)</span>
                  </div>
                  <div className="w-full bg-blue-200/50 rounded-full h-2.5 overflow-hidden">
                    <div 
                      className="bg-blue-600 h-2.5 rounded-full transition-all duration-500 ease-out" 
                      style={{ width: `${(processProgress.current / processProgress.total) * 100}%` }}
                    ></div>
                  </div>
                </div>
              )}

              {processError && (
                <div className="p-3 bg-red-50 text-red-700 text-sm rounded-lg flex items-start gap-2">
                  <AlertCircle size={16} className="shrink-0 mt-0.5" />
                  <p>{processError}</p>
                </div>
              )}

              {processedBlob && !isProcessing && !processError && (
                <div className="p-3 bg-emerald-50 text-emerald-700 text-sm rounded-lg flex items-start gap-2 border border-emerald-100">
                  <CheckCircle size={16} className="shrink-0 mt-0.5" />
                  <p>검수가 완료되어 파일이 자동으로 다운로드되었습니다. 다시 다운로드하려면 아래 버튼을 클릭하세요.</p>
                </div>
              )}

              {processedBlob && (
                <button
                  onClick={handleDownload}
                  className="w-full py-3 px-4 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
                >
                  <Download size={18} />
                  <span>검수 완료된 파일 다운로드</span>
                </button>
              )}
            </div>
          </div>
        </section>

        {/* Extracted Rules Table */}
          <section className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">저장된 매핑 규칙 예시</h2>
                <p className="text-sm text-slate-500">
                  {rules.length > 0
                    ? `총 ${rules.length}개의 매핑 규칙이 저장되어 있습니다.`
                    : '저장된 매핑 규칙이 없습니다. 엑셀로 학습하거나 JSON 파일을 불러오세요.'}
                </p>
              </div>
              {rules.length > 0 && (
                <button
                  onClick={handleClearRules}
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
                disabled={rules.length === 0}
                className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Download size={16} className="text-rose-600" />
                <span>JSON으로 내보내기 (백업)</span>
              </button>
              <button
                onClick={() => jsonInputRef.current?.click()}
                className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors shadow-sm"
              >
                <Upload size={16} className="text-blue-600" />
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
            {rules.length > 0 ? (
              <div className="overflow-x-auto max-h-96">
                <table className="w-full text-sm text-left">
                  <thead className="text-xs text-slate-500 uppercase bg-slate-50 sticky top-0">
                    <tr>
                      <th className="px-6 py-3 font-medium">사이트수집상품명 (V)</th>
                      <th className="px-6 py-3 font-medium">옵션명 (P)</th>
                      <th className="px-6 py-3 font-medium">수량 (S)</th>
                      <th className="px-6 py-3 font-medium">품목명 (G)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rules.map((rule, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/50">
                        <td className="px-6 py-3 text-slate-600">{rule.siteProductName}</td>
                        <td className="px-6 py-3 text-slate-600">{rule.optionName}</td>
                        <td className="px-6 py-3 text-slate-600 font-mono">{rule.quantity}</td>
                        <td className="px-6 py-3 font-medium text-slate-900">{rule.mappedItemName}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-12 text-center flex flex-col items-center justify-center bg-slate-50/50">
                <FileText className="text-slate-300 mb-3" size={48} />
                <p className="text-slate-500 font-medium">저장된 매핑 규칙이 없습니다</p>
                <p className="text-slate-400 text-sm mt-1">위의 'JSON 불러오기' 버튼을 클릭하여 백업된 규칙을 복원하세요.</p>
              </div>
            )}
          </section>
      </main>
    </div>
  );
}
