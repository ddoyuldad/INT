import React, { useState, useRef } from 'react';
import { UploadCloud, FileText, Download, CheckCircle, AlertCircle, Loader2, ShoppingCart, Trash2 } from 'lucide-react';
import { PDFDocument } from 'pdf-lib';
import { processCostcoPdfDoc, CostcoOrder, generateCostcoExcel } from '../services/costcoService';

export default function CostcoApp() {
  const [pdfFiles, setPdfFiles] = useState<File[]>([]);
  const [orders, setOrders] = useState<CostcoOrder[]>([]);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  const pdfInputRef = useRef<HTMLInputElement>(null);

  const handlePdfUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setPdfFiles(prev => [...prev, ...Array.from(e.target.files!)]);
    }
  };

  const removePdf = (index: number) => {
    setPdfFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleProcessPdfs = async () => {
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
          const chunks = Math.ceil(pdfDoc.getPageCount() / 5); // CHUNK_SIZE
          totalChunks += chunks;
          loadedDocs.push(pdfDoc);
        } catch (e) {
          throw new Error(`'${file.name}' 파일을 읽을 수 없습니다. 암호가 걸려있거나 손상된 파일인지 확인 후 제외하고 다시 업로드해주세요.`);
        }
      }

      setProgress({ current: 0, total: totalChunks });

      let allOrders: CostcoOrder[] = [];
      let currentCompleted = 0;
      
      for (const pdfDoc of loadedDocs) {
        const extracted = await processCostcoPdfDoc(pdfDoc, () => {
          currentCompleted++;
          setProgress({ current: currentCompleted, total: totalChunks });
        });
        allOrders = [...allOrders, ...extracted];
      }
      
      setOrders(allOrders);
      setPdfFiles([]); // Clear uploaded PDFs after successful extraction
    } catch (error: any) {
      setExtractError(error.message || "알 수 없는 오류가 발생했습니다. 새로고침 후 다시 시도해주세요.");
    } finally {
      setIsExtracting(false);
    }
  };

  const [isDownloading, setIsDownloading] = useState(false);

  const handleDownloadExcel = async () => {
    if (orders.length === 0) return;
    setIsDownloading(true);
    try {
      const blob = await generateCostcoExcel(orders);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `코스트코_발주서_변환.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Excel generation error:", error);
      alert("엑셀 파일 생성 중 오류가 발생했습니다.");
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      <header className="bg-white border-b border-slate-200 py-6 px-8 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 p-2 rounded-lg text-white">
              <ShoppingCart size={24} />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">코스트코 발주서 매칭 프로그램</h1>
              <p className="text-sm text-slate-500">코스트코 발주서 PDF를 업로드하면 사방넷 엑셀 양식으로 변환해 드립니다.</p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto py-8 px-8 flex flex-col gap-8">
        <section className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
          <div className="p-6 border-b border-slate-100 bg-slate-50/50">
            <div className="flex items-center gap-3 mb-1">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-700 font-bold text-xs">1</span>
              <h2 className="text-lg font-semibold">코스트코 발주서 PDF 업로드</h2>
            </div>
            <p className="text-sm text-slate-500 ml-9">코스트코 발주서 PDF를 업로드하여 주문 정보를 추출합니다.</p>
          </div>
          
          <div className="p-6">
            <div 
              className="border-2 border-dashed border-slate-300 rounded-xl p-8 text-center hover:bg-slate-50 transition-colors cursor-pointer mb-4"
              onClick={() => pdfInputRef.current?.click()}
            >
              <UploadCloud className="mx-auto text-slate-400 mb-3" size={32} />
              <p className="text-sm font-medium text-slate-700">PDF 파일 업로드</p>
              <p className="text-xs text-slate-500 mt-1">클릭하여 여러 파일을 선택할 수 있습니다.</p>
              <input 
                type="file" 
                multiple 
                accept=".pdf" 
                className="hidden" 
                ref={pdfInputRef}
                onChange={handlePdfUpload}
              />
            </div>

            {pdfFiles.length > 0 && (
              <div className="mb-6">
                <h3 className="text-sm font-medium text-slate-700 mb-2">업로드된 파일 ({pdfFiles.length})</h3>
                <ul className="space-y-2 max-h-40 overflow-y-auto pr-2">
                  {pdfFiles.map((file, idx) => (
                    <li key={idx} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-100">
                      <div className="flex items-center gap-3 overflow-hidden">
                        <FileText size={16} className="text-blue-500 shrink-0" />
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
                onClick={handleProcessPdfs}
                disabled={pdfFiles.length === 0 || isExtracting}
                className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
              >
                {isExtracting ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    <span>발주서 분석 및 변환 중...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle size={18} />
                    <span>발주서 변환 시작</span>
                  </>
                )}
              </button>

              {isExtracting && progress.total > 0 && (
                <div className="mt-4 p-4 bg-blue-50 rounded-xl border border-blue-100">
                  <div className="flex justify-between text-xs font-medium text-blue-700 mb-2">
                    <span>분석 진행률</span>
                    <span>{Math.round((progress.current / progress.total) * 100)}% ({progress.current}/{progress.total} 완료)</span>
                  </div>
                  <div className="w-full bg-blue-200/50 rounded-full h-2.5 overflow-hidden">
                    <div 
                      className="bg-blue-600 h-2.5 rounded-full transition-all duration-500 ease-out" 
                      style={{ width: `${(progress.current / progress.total) * 100}%` }}
                    ></div>
                  </div>
                  <p className="text-xs text-blue-500 mt-2 text-center">
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

        {orders.length > 0 && (
          <section className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">추출된 발주서 목록</h2>
                <p className="text-sm text-slate-500">총 {orders.length}건의 주문이 추출되었습니다.</p>
              </div>
              <button
                onClick={handleDownloadExcel}
                disabled={isDownloading}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-400 text-white rounded-lg font-medium transition-colors"
              >
                {isDownloading ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
                <span>{isDownloading ? '생성 중...' : '엑셀 다운로드'}</span>
              </button>
            </div>
            <div className="overflow-x-auto max-h-96">
              <table className="w-full text-sm text-left whitespace-nowrap">
                <thead className="text-xs text-slate-500 uppercase bg-slate-50 sticky top-0">
                  <tr>
                    <th className="px-6 py-3">주문번호</th>
                    <th className="px-6 py-3">상품코드</th>
                    <th className="px-6 py-3">상품명</th>
                    <th className="px-6 py-3">수량</th>
                    <th className="px-6 py-3">공급가</th>
                    <th className="px-6 py-3">수취인</th>
                    <th className="px-6 py-3">수취인핸드폰</th>
                    <th className="px-6 py-3">수취인주소</th>
                    <th className="px-6 py-3">우편번호</th>
                    <th className="px-6 py-3">배송메세지</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {orders.map((order, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/50">
                      <td className="px-6 py-3 font-mono">{order.orderNumber}</td>
                      <td className="px-6 py-3 font-mono">{order.productCode}</td>
                      <td className="px-6 py-3">{order.productName}</td>
                      <td className="px-6 py-3">{order.quantity}</td>
                      <td className="px-6 py-3 font-mono">{order.supplyPrice}</td>
                      <td className="px-6 py-3">{order.recipientName}</td>
                      <td className="px-6 py-3">{order.recipientPhone}</td>
                      <td className="px-6 py-3 truncate max-w-xs" title={order.shippingAddress}>{order.shippingAddress}</td>
                      <td className="px-6 py-3">{order.zipCode}</td>
                      <td className="px-6 py-3">{order.shippingMessage}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
