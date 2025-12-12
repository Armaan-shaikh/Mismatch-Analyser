
import React, { useRef, useState } from 'react';
import { ReconciliationRecord } from '../types';
import { Upload, CheckCircle, AlertTriangle, Loader2, RefreshCw, Calendar } from 'lucide-react';

interface Props {
  record: ReconciliationRecord;
  onUploadImage: (id: string, file: File) => void;
}

export const StoreCard: React.FC<Props> = ({ record, onUploadImage }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current += 1;
    if (record.status !== 'processing') {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current -= 1;
    if (dragCounter.current === 0) {
      setIsDragging(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Essential to allow dropping
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounter.current = 0;

    if (record.status === 'processing') return;

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (file.type.startsWith('image/')) {
        onUploadImage(record.id, file);
      }
    }
  };

  const getStatusColor = () => {
    if (isDragging) return 'border-brand-500 bg-brand-50 dark:bg-brand-900/30 ring-2 ring-brand-200 dark:ring-brand-800 border-l-4 border-l-brand-600';

    if (record.status === 'completed') {
      const phys = record.physical!;
      const netCash = phys.cashCount + phys.expenses;
      const cashDiff = netCash - record.system.cash;
      const upiDiff = phys.upiMachineTotal - record.system.upi;
      const cardDiff = phys.cardMachineTotal - record.system.card;
      const sodexoDiff = phys.sodexoTotal - record.system.sodexo;
      
      const isPerfect = cashDiff === 0 && upiDiff === 0 && cardDiff === 0 && sodexoDiff === 0;
      return isPerfect 
        ? 'border-l-4 border-l-green-500 bg-green-50/30 dark:bg-green-900/10' 
        : 'border-l-4 border-l-red-500 bg-red-50/30 dark:bg-red-900/10';
    }
    if (record.status === 'error') return 'border-l-4 border-l-red-500 bg-white dark:bg-slate-800 border-red-200 dark:border-red-900';
    if (record.status === 'processing') return 'border-l-4 border-l-brand-500 bg-brand-50/30 dark:bg-brand-900/10';
    return 'border-l-4 border-l-gray-200 dark:border-l-slate-600 hover:border-l-gray-300 dark:hover:border-l-slate-500';
  };

  return (
    <div 
      className={`relative p-3 rounded-lg bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 shadow-sm transition-all duration-200 ${getStatusColor()}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag Overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-10 bg-white/60 dark:bg-slate-900/60 flex items-center justify-center rounded-lg backdrop-blur-[1px] pointer-events-none">
          <div className="bg-brand-600 text-white px-3 py-1.5 rounded-full text-xs font-bold shadow-md flex items-center gap-2 animate-bounce">
            <Upload size={14} /> Drop to Upload
          </div>
        </div>
      )}

      <div className="flex justify-between items-start gap-3 relative z-0">
        {/* Header Section */}
        <div className="flex-1 min-w-0">
          <div className="flex flex-col gap-1 mb-2">
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 truncate" title={record.storeName}>
              {record.storeName}
            </h3>
            <div className="flex items-center gap-2">
               <span className="flex items-center gap-1 text-[10px] bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-gray-300 px-1.5 py-0.5 rounded border border-gray-200 dark:border-slate-600">
                  <Calendar size={10} />
                  {record.system.date}
               </span>
               {record.status === 'completed' && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-gray-300 font-medium">
                    {record.physical?.extractedStoreName ? `Matched: ${record.physical.extractedStoreName}` : 'Processed'}
                  </span>
               )}
            </div>
          </div>
          
          {/* Status / Details */}
          {record.status === 'completed' && record.physical ? (
            <div className="grid grid-cols-2 gap-2 text-[10px] mt-2">
              {/* Cash Variance */}
              <div className="bg-white dark:bg-slate-900 p-1 rounded border border-gray-100 dark:border-slate-700 flex justify-between items-center">
                <span className="text-gray-400 dark:text-gray-500">Cash Var</span>
                <span className={`font-mono font-bold ${
                   ((record.physical.cashCount + record.physical.expenses) - record.system.cash) === 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                }`}>
                  {((record.physical.cashCount + record.physical.expenses) - record.system.cash) > 0 ? '+' : ''}
                  {((record.physical.cashCount + record.physical.expenses) - record.system.cash).toLocaleString()}
                </span>
              </div>
              {/* UPI Variance */}
               <div className="bg-white dark:bg-slate-900 p-1 rounded border border-gray-100 dark:border-slate-700 flex justify-between items-center">
                <span className="text-gray-400 dark:text-gray-500">UPI Var</span>
                <span className={`font-mono font-bold ${
                   (record.physical.upiMachineTotal - record.system.upi) === 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                }`}>
                  {(record.physical.upiMachineTotal - record.system.upi) > 0 ? '+' : ''}
                  {(record.physical.upiMachineTotal - record.system.upi).toLocaleString()}
                </span>
              </div>
              {/* Card Variance */}
              <div className="bg-white dark:bg-slate-900 p-1 rounded border border-gray-100 dark:border-slate-700 flex justify-between items-center">
                <span className="text-gray-400 dark:text-gray-500">Card Var</span>
                <span className={`font-mono font-bold ${
                   (record.physical.cardMachineTotal - record.system.card) === 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                }`}>
                  {(record.physical.cardMachineTotal - record.system.card) > 0 ? '+' : ''}
                  {(record.physical.cardMachineTotal - record.system.card).toLocaleString()}
                </span>
              </div>
               {/* Sodexo Variance */}
               <div className="bg-white dark:bg-slate-900 p-1 rounded border border-gray-100 dark:border-slate-700 flex justify-between items-center">
                <span className="text-gray-400 dark:text-gray-500">Sdx Var</span>
                <span className={`font-mono font-bold ${
                   (record.physical.sodexoTotal - record.system.sodexo) === 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                }`}>
                  {(record.physical.sodexoTotal - record.system.sodexo) > 0 ? '+' : ''}
                  {(record.physical.sodexoTotal - record.system.sodexo).toLocaleString()}
                </span>
              </div>
            </div>
          ) : (
            <div className="mt-1">
               {record.status === 'processing' && (
                 <div className="flex items-center gap-2 text-xs text-brand-600 dark:text-brand-400 font-medium animate-pulse">
                   <Loader2 size={12} className="animate-spin" />
                   <span>Processing image...</span>
                 </div>
               )}
               {record.status === 'error' && (
                 <div className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400 font-medium">
                   <AlertTriangle size={12} />
                   <span>Extraction failed. Please try again.</span>
                 </div>
               )}
               {record.status === 'pending' && (
                 <p className="text-xs text-gray-400 dark:text-gray-500 italic">Waiting for report...</p>
               )}
            </div>
          )}
        </div>

        {/* Action Button */}
        <div className="flex-shrink-0 self-center">
            <input 
              type="file" 
              ref={fileInputRef}
              className="hidden"
              accept="image/*"
              onChange={(e) => {
                if (e.target.files?.[0]) {
                  // Reset input value so onChange fires again even if same file selected
                  onUploadImage(record.id, e.target.files[0]);
                  e.target.value = '';
                }
              }}
            />
            
            <button 
              onClick={() => fileInputRef.current?.click()}
              disabled={record.status === 'processing'}
              className={`flex items-center justify-center gap-1.5 transition-all rounded-md border text-xs font-medium ${
                  record.status === 'error'
                    ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border-red-200 dark:border-red-900 hover:bg-red-100 dark:hover:bg-red-900/30 px-3 py-1.5'
                    : record.status === 'completed' 
                      ? 'bg-transparent text-gray-400 dark:text-gray-500 border-transparent hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700 p-1.5'
                      : 'bg-white dark:bg-slate-900 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-slate-600 hover:text-brand-600 dark:hover:text-brand-400 hover:border-brand-200 dark:hover:border-brand-800 hover:bg-brand-50 dark:hover:bg-brand-900/20 p-1.5'
              } ${record.status === 'processing' ? 'opacity-50 cursor-not-allowed border-transparent' : ''}`}
              title={
                record.status === 'error' ? "Retry Upload" :
                record.status === 'completed' ? "Re-upload Report" : "Upload Report"
              }
            >
              {record.status === 'processing' ? (
                 <Loader2 size={16} className="animate-spin text-brand-500 dark:text-brand-400" />
              ) : record.status === 'error' ? (
                 <>
                   <RefreshCw size={14} /> 
                   <span>Retry</span>
                 </>
              ) : record.status === 'completed' ? (
                 <RefreshCw size={16} />
              ) : (
                 <Upload size={16} />
              )}
            </button>
        </div>
      </div>
    </div>
  );
};
