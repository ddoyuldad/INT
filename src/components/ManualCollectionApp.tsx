import React, { useState } from 'react';
import CostcoApp from './CostcoApp';
import ShopByApp from './ShopByApp';
import { ShoppingCart, FileSpreadsheet } from 'lucide-react';

export default function ManualCollectionApp() {
  const [activeTab, setActiveTab] = useState<'costco' | 'shopby'>('costco');

  return (
    <div className="flex flex-col h-full w-full">
      {/* Sub Navigation */}
      <div className="bg-white border-b border-slate-200 px-8 py-3 flex justify-center gap-3 shadow-sm z-10 relative">
        <button
          onClick={() => setActiveTab('costco')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeTab === 'costco'
              ? 'bg-blue-50 text-blue-700 border border-blue-200'
              : 'text-slate-600 hover:bg-slate-50 border border-transparent'
          }`}
        >
          <ShoppingCart size={16} />
          <span>코스트코 발주서</span>
        </button>
        <button
          onClick={() => setActiveTab('shopby')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeTab === 'shopby'
              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
              : 'text-slate-600 hover:bg-slate-50 border border-transparent'
          }`}
        >
          <FileSpreadsheet size={16} />
          <span>SHOP BY 발주서</span>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 relative">
        <div className={activeTab === 'costco' ? 'block' : 'hidden'}>
          <CostcoApp />
        </div>
        <div className={activeTab === 'shopby' ? 'block' : 'hidden'}>
          <ShopByApp />
        </div>
      </div>
    </div>
  );
}
