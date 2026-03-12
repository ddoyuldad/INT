import React, { useState } from 'react';
import SabangnetApp from './components/SabangnetApp';
import ManualCollectionApp from './components/ManualCollectionApp';
import SabangnetMappingApp from './components/SabangnetMappingApp';
import { Package, ShoppingCart, FileSearch } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState<'sabangnet' | 'manual' | 'mapping'>('sabangnet');

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col">
      {/* Global Tab Navigation */}
      <div className="bg-slate-900 text-white shadow-md z-20 sticky top-0">
        <div className="max-w-5xl mx-auto px-8 flex items-center justify-center">
          <div className="flex space-x-1">
            <button
              onClick={() => setActiveTab('sabangnet')}
              className={`flex items-center gap-2 px-5 py-4 text-sm font-medium transition-colors border-b-2 ${
                activeTab === 'sabangnet'
                  ? 'border-indigo-400 text-white bg-slate-800'
                  : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <Package size={18} />
              <span>공구 코드 매칭 프로그램</span>
            </button>
            <button
              onClick={() => setActiveTab('manual')}
              className={`flex items-center gap-2 px-5 py-4 text-sm font-medium transition-colors border-b-2 ${
                activeTab === 'manual'
                  ? 'border-blue-400 text-white bg-slate-800'
                  : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <ShoppingCart size={18} />
              <span>수동 수집 사이트</span>
            </button>
            <button
              onClick={() => setActiveTab('mapping')}
              className={`flex items-center gap-2 px-5 py-4 text-sm font-medium transition-colors border-b-2 ${
                activeTab === 'mapping'
                  ? 'border-rose-400 text-white bg-slate-800'
                  : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <FileSearch size={18} />
              <span>사방넷 매핑 프로그램</span>
            </button>
          </div>
        </div>
      </div>

      {/* Active App Content */}
      <div className="flex-1 relative">
        <div className={activeTab === 'sabangnet' ? 'block' : 'hidden'}>
          <SabangnetApp />
        </div>
        <div className={activeTab === 'manual' ? 'block' : 'hidden'}>
          <ManualCollectionApp />
        </div>
        <div className={activeTab === 'mapping' ? 'block' : 'hidden'}>
          <SabangnetMappingApp />
        </div>
      </div>
    </div>
  );
}

