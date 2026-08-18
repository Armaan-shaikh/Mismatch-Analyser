
import React, { useState, useEffect } from 'react';
import { AppStep, ReconciliationRecord, PhysicalData } from './types';
import { StepIndicator } from './components/StepIndicator';
import { StoreCard } from './components/StoreCard';
import { LandingPage } from './components/LandingPage';
import { parseSystemExcel, generateReconciliationExcel } from './services/excelService';
import { extractHandwrittenReport } from './services/geminiService';
import { Upload, Download, AlertCircle, RefreshCw, FileSpreadsheet, ArrowRight, Images, FileImage, Loader2, Calendar, Search, X, FileCheck, Moon, Sun, ArrowLeft, Trash2 } from 'lucide-react';

const App: React.FC = () => {
  const [step, setStep] = useState<AppStep>(AppStep.HOME);
  const [records, setRecords] = useState<ReconciliationRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0); // Used to force-remount file inputs
  
  // Dark Mode State
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('theme') === 'dark' || 
             (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches);
    }
    return false;
  });

  // Search states
  const [systemSearch, setSystemSearch] = useState("");
  const [physicalSearch, setPhysicalSearch] = useState("");
  
  // Drag states
  const [isDraggingExcel, setIsDraggingExcel] = useState(false);
  const [isDraggingPhotos, setIsDraggingPhotos] = useState(false);
  
  // Processing queue state
  const [processingQueue, setProcessingQueue] = useState<string[]>([]);

  // Apply dark mode class
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [darkMode]);

  const toggleDarkMode = () => setDarkMode(!darkMode);

  const handleReset = () => {
    // Removed window.confirm to ensure button works immediately and avoids browser blocking issues
    setRecords([]);
    setError(null);
    setSystemSearch("");
    setPhysicalSearch("");
    setProcessingQueue([]);
    setIsDraggingExcel(false);
    setIsDraggingPhotos(false);
    setStep(AppStep.DASHBOARD);
    setResetKey(prev => prev + 1); // Force regeneration of file inputs
    window.scrollTo(0, 0);
  };

  const processExcelFile = async (file: File) => {
    try {
      const systemData = await parseSystemExcel(file);
      if (systemData.length === 0) {
        setError("No valid data found in Excel. Ensure columns like 'Store', 'Cash', 'UPI' exist.");
        return;
      }

      const newRecords: ReconciliationRecord[] = systemData.map((sys, index) => ({
        id: `store-${index}-${Date.now()}`,
        storeName: sys.storeName || `Store ${index + 1}`,
        system: sys,
        physical: null,
        status: 'pending'
      }));

      setRecords(newRecords);
      setError(null);
    } catch (err) {
      setError("Failed to parse Excel file. Please ensure it is a valid .xlsx or .xls file.");
    }
  };

  const handleSystemUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processExcelFile(file);
    }
    // We clear the value via the onClick handler now to be safer, but keeping this doesn't hurt
    e.target.value = '';
  };

  // --- Matching Logic ---
  const findMatchingRecordId = (extractedName: string | undefined, extractedDate: string | undefined): string | null => {
    if (!extractedName) return null;
    
    const normalizedExtractedName = extractedName.toLowerCase().replace(/[^a-z0-9]/g, '');
    
    // Helper to check name match
    const isNameMatch = (recordName: string) => {
      const normalizedRecordName = recordName.toLowerCase().replace(/[^a-z0-9]/g, '');
      return normalizedRecordName.includes(normalizedExtractedName) || normalizedExtractedName.includes(normalizedRecordName);
    };

    // Filter potential candidates by name first
    const candidates = records.filter(r => isNameMatch(r.storeName));

    if (candidates.length === 0) return null;

    // If Date is extracted, try to match specifically by date
    if (extractedDate) {
      const dateMatch = candidates.find(r => r.system.date === extractedDate);
      if (dateMatch) return dateMatch.id;
      return null;
    }

    // If no date extracted, but only one candidate exists, return it
    if (candidates.length === 1) return candidates[0].id;
    
    return null;
  };

  // --- Image Processing ---
  const processImageFile = async (file: File, manualRecordId?: string) => {
    // Generate a temporary ID for tracking if manual ID isn't provided
    const tempId = manualRecordId || `temp-${file.name}-${Date.now()}`;
    
    // If manual, set that record to processing immediately
    if (manualRecordId) {
      setRecords(prev => prev.map(r => r.id === manualRecordId ? { ...r, status: 'processing' } : r));
    } else {
      setProcessingQueue(prev => [...prev, file.name]);
    }

    try {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      
      reader.onload = async () => {
        const base64 = reader.result as string;
        try {
          const extractedData = await extractHandwrittenReport(base64);
          
          let targetId = manualRecordId;

          // If no manual target, try to find one
          if (!targetId) {
             targetId = findMatchingRecordId(extractedData.extractedStoreName, extractedData.extractedDate);
          }

          if (targetId) {
            setRecords(prev => prev.map(r => {
              if (r.id === targetId) {
                return {
                  ...r,
                  physical: extractedData,
                  status: 'completed',
                  rawImage: base64,
                  errorMessage: undefined
                };
              }
              return r;
            }));
          } else {
            // No match found
            const msg = extractedData.extractedDate 
              ? `No match for "${extractedData.extractedStoreName}" on ${extractedData.extractedDate}`
              : `Could not distinguish store/date for "${extractedData.extractedStoreName}"`;
            setError(`${msg}. Please upload manually.`);
          }
        } catch (apiError: any) {
          console.error(apiError);
          if (manualRecordId) {
            setRecords(prev => prev.map(r => r.id === manualRecordId ? { ...r, status: 'error' } : r));
          }
          const errMsg = apiError?.message || "Failed to analyze image";
          setError(`${file.name}: ${errMsg}`);
        } finally {
          setProcessingQueue(prev => prev.filter(name => name !== file.name));
        }
      };
    } catch (err) {
      console.error(err);
      if (manualRecordId) {
        setRecords(prev => prev.map(r => r.id === manualRecordId ? { ...r, status: 'error' } : r));
      }
      setProcessingQueue(prev => prev.filter(name => name !== file.name));
    }
  };

  const handleBulkDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingPhotos(false);
    
    if (e.dataTransfer.files) {
      Array.from(e.dataTransfer.files).forEach((file: File) => {
        if (file.type.startsWith('image/')) {
          processImageFile(file);
        }
      });
    }
  };

  const filteredSystemRecords = records.filter(r => 
    r.storeName.toLowerCase().includes(systemSearch.toLowerCase()) ||
    r.system.date.includes(systemSearch)
  );

  const filteredPhysicalRecords = records
    .filter(r => 
      r.storeName.toLowerCase().includes(physicalSearch.toLowerCase()) ||
      r.system.date.includes(physicalSearch) ||
      r.physical?.extractedStoreName?.toLowerCase().includes(physicalSearch.toLowerCase())
    )
    .sort((a, b) => {
      // Sort priority: Processed/Processing/Error first, Pending last
      const aActive = a.status !== 'pending';
      const bActive = b.status !== 'pending';
      
      if (aActive && !bActive) return -1;
      if (!aActive && bActive) return 1;
      return 0;
    });

  // Filter records that are completed for export and review view
  const completedRecords = records.filter(r => r.status === 'completed');

  // --- Export ---
  const handleExport = () => {
    try {
      if (completedRecords.length === 0) {
        setError("No completed records to export.");
        return;
      }
      generateReconciliationExcel(completedRecords);
    } catch (err) {
      setError("Failed to generate export file.");
    }
  };

  // Helper to clear input before selection to ensure onChange fires
  const onInputClick = (e: React.MouseEvent<HTMLInputElement>) => {
    (e.target as HTMLInputElement).value = '';
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 pb-12 font-sans text-slate-900 dark:text-slate-100 transition-colors duration-300">
      {/* Header */}
      <header className="bg-white dark:bg-slate-900 border-b border-gray-200 dark:border-slate-800 sticky top-0 z-50 shadow-sm transition-colors duration-300">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            
            <div className="flex items-center gap-4">
              {step !== AppStep.HOME && (
                <button 
                  onClick={() => setStep(AppStep.HOME)}
                  className="flex items-center justify-center p-2 rounded-full text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-slate-800 transition-all mr-1"
                  title="Back to Home"
                >
                  <ArrowLeft size={20} />
                </button>
              )}
              <div 
                className="flex items-center gap-2 cursor-pointer" 
                onClick={() => setStep(AppStep.HOME)}
              >
                <div className="w-8 h-8 bg-gradient-to-br from-brand-500 to-brand-700 rounded-lg flex items-center justify-center text-white font-bold shadow-sm">
                  M
                </div>
                <span className="text-xl font-bold text-gray-900 dark:text-white tracking-tight hidden sm:inline">Mismatch Checker</span>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <button 
                onClick={toggleDarkMode}
                className="p-2 rounded-full text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-slate-800 transition-colors"
                title={darkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
              >
                {darkMode ? <Sun size={20} /> : <Moon size={20} />}
              </button>

              {/* Reset button in header - always available if not home */}
              {step !== AppStep.HOME && (
                <button 
                  onClick={handleReset}
                  className="text-gray-400 hover:text-red-600 dark:hover:text-red-400 p-2 rounded-full hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                  title="Reset Data"
                >
                  <RefreshCw size={20} />
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        {step === AppStep.HOME ? (
          <LandingPage onStart={() => setStep(AppStep.DASHBOARD)} />
        ) : (
          <>
            <StepIndicator 
              currentStep={step} 
              onStepChange={setStep} 
              canProceed={records.some(r => r.status === 'completed')}
            />

            {error && (
              <div className="mb-6 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 flex items-start gap-3 text-red-700 dark:text-red-400 shadow-sm animate-fade-in">
                <AlertCircle size={20} className="mt-0.5 flex-shrink-0" />
                <p>{error}</p>
                <button onClick={() => setError(null)} className="ml-auto text-red-500 hover:text-red-700 dark:hover:text-red-300">
                  <X size={16} />
                </button>
              </div>
            )}

            <div className="transition-opacity duration-300">
              {step === AppStep.DASHBOARD && (
                <>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 h-[calc(100vh-220px)] min-h-[600px]">
                    {/* Left Column: System Data (Excel) */}
                    <div 
                      className={`relative flex flex-col bg-white dark:bg-slate-900 rounded-2xl shadow-sm border transition-all duration-200 overflow-hidden ${
                        isDraggingExcel 
                          ? 'border-brand-500 ring-4 ring-brand-50 dark:ring-brand-900/30' 
                          : 'border-brand-100 dark:border-slate-800'
                      }`}
                      onDragOver={(e) => { e.preventDefault(); setIsDraggingExcel(true); }}
                      onDragLeave={(e) => { e.preventDefault(); setIsDraggingExcel(false); }}
                      onDrop={(e) => {
                        e.preventDefault();
                        setIsDraggingExcel(false);
                        if (e.dataTransfer.files?.[0]) processExcelFile(e.dataTransfer.files[0]);
                      }}
                    >
                      {isDraggingExcel && (
                        <div className="absolute inset-0 bg-brand-50/90 dark:bg-slate-800/90 z-50 flex flex-col items-center justify-center backdrop-blur-sm animate-in fade-in">
                            <FileSpreadsheet size={48} className="text-brand-600 mb-4 animate-bounce" />
                            <p className="text-xl font-bold text-brand-700 dark:text-brand-400">Drop Excel File Here</p>
                        </div>
                      )}

                      <div className="p-4 bg-brand-50 dark:bg-slate-800/50 border-b border-brand-100 dark:border-slate-800 flex justify-between items-center relative z-10">
                        <h2 className="font-bold text-brand-900 dark:text-brand-100 flex items-center gap-2">
                          <FileSpreadsheet size={20} /> System Data (Excel)
                        </h2>
                        {records.length > 0 && (
                          <label className="text-xs font-medium text-brand-600 dark:text-brand-400 cursor-pointer hover:text-brand-800 dark:hover:text-brand-200 bg-white dark:bg-slate-800 px-3 py-1.5 rounded-md border border-brand-200 dark:border-slate-700 shadow-sm transition-colors">
                            Re-upload Excel
                            <input 
                              key={`reupload-sys-${resetKey}`}
                              type="file" 
                              className="hidden" 
                              accept=".xlsx, .xls" 
                              onClick={onInputClick}
                              onChange={handleSystemUpload} 
                            />
                          </label>
                        )}
                      </div>

                      {/* System Data Search */}
                      {records.length > 0 && (
                        <div className="p-2 bg-white dark:bg-slate-900 border-b border-brand-50 dark:border-slate-800 sticky top-0 z-20">
                          <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                            <input 
                              type="text" 
                              placeholder="Search store or date..." 
                              className="w-full pl-9 pr-8 py-2 text-sm bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 border border-gray-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
                              value={systemSearch}
                              onChange={e => setSystemSearch(e.target.value)}
                              autoFocus={false}
                            />
                            {systemSearch && (
                              <button 
                                onClick={() => setSystemSearch('')}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                              >
                                <X size={14} />
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                      
                      <div className="flex-1 overflow-y-auto p-4 bg-slate-50/50 dark:bg-slate-950/50 relative z-10">
                        {records.length === 0 ? (
                          <div className="h-full flex flex-col items-center justify-center border-2 border-dashed border-gray-300 dark:border-slate-700 rounded-xl p-8 bg-white dark:bg-slate-900 transition-colors hover:border-brand-300 hover:bg-brand-50/10">
                              <div className="w-16 h-16 bg-blue-50 dark:bg-slate-800 text-blue-500 rounded-full flex items-center justify-center mb-4">
                                <Upload size={32} />
                              </div>
                              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Upload Sales Report</h3>
                              <p className="text-gray-500 dark:text-gray-400 text-center text-sm mb-6 max-w-xs">
                                Drag and drop your daily sales Excel file here to populate the store list.
                              </p>
                              <label className="cursor-pointer bg-brand-600 text-white px-6 py-2.5 rounded-lg font-medium hover:bg-brand-700 transition-colors shadow-sm">
                                Browse Files
                                <input 
                                  key={`init-sys-${resetKey}`}
                                  type="file" 
                                  className="hidden" 
                                  accept=".xlsx, .xls" 
                                  onClick={onInputClick}
                                  onChange={handleSystemUpload} 
                                />
                              </label>
                          </div>
                        ) : (
                          <div className="space-y-3">
                            <div className="px-2 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider flex justify-between">
                                <span>Store / Date ({filteredSystemRecords.length})</span>
                                <span>Breakdown</span>
                            </div>
                            {filteredSystemRecords.length === 0 && (
                                <div className="text-center py-8 text-gray-400 text-sm">No matches found for "{systemSearch}"</div>
                            )}
                            {filteredSystemRecords.map(record => (
                              <div key={record.id} className="bg-white dark:bg-slate-800 p-4 rounded-lg border border-gray-200 dark:border-slate-700 shadow-sm transition-colors">
                                  <div className="flex justify-between items-center border-b border-gray-100 dark:border-slate-700 pb-2 mb-2">
                                    <div className="flex flex-col">
                                      <h3 className="font-semibold text-gray-800 dark:text-gray-200">{record.storeName}</h3>
                                      <span className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                                        <Calendar size={12} /> {record.system.date}
                                      </span>
                                    </div>
                                    <div className="text-right">
                                      <span className="block text-sm font-bold text-brand-600 dark:text-brand-400">₹{record.system.totalSales.toLocaleString()}</span>
                                      <span className="text-[10px] text-gray-400 uppercase">Total Sales</span>
                                    </div>
                                  </div>
                                  
                                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs text-gray-600 dark:text-gray-300">
                                    <div className="flex justify-between items-center">
                                      <span className="text-gray-400">Cash:</span> 
                                      <span className="font-mono font-medium">₹{record.system.cash.toLocaleString()}</span>
                                    </div>
                                    <div className="flex justify-between items-center">
                                      <span className="text-gray-400">UPI:</span> 
                                      <span className="font-mono font-medium">₹{record.system.upi.toLocaleString()}</span>
                                    </div>
                                    <div className="flex justify-between items-center">
                                      <span className="text-gray-400">Card:</span> 
                                      <span className="font-mono font-medium">₹{record.system.card.toLocaleString()}</span>
                                    </div>
                                    <div className="flex justify-between items-center">
                                      <span className="text-gray-400">Sodexo:</span> 
                                      <span className="font-mono font-medium">₹{record.system.sodexo.toLocaleString()}</span>
                                    </div>
                                    <div className="flex justify-between items-center col-span-2 border-t border-gray-50 dark:border-slate-700 pt-1 mt-1">
                                      <span className="text-gray-400">Bank Transfer:</span> 
                                      <span className="font-mono font-medium">₹{record.system.bankTransfer.toLocaleString()}</span>
                                    </div>
                                  </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Right Column: Physical Data (Photos) */}
                    <div 
                      className={`flex flex-col bg-white dark:bg-slate-900 rounded-2xl shadow-sm border transition-all duration-200 overflow-hidden ${
                        isDraggingPhotos 
                          ? 'border-purple-500 ring-4 ring-purple-50 dark:ring-purple-900/30' 
                          : 'border-gray-200 dark:border-slate-800'
                      }`}
                      onDragOver={(e) => { e.preventDefault(); setIsDraggingPhotos(true); }}
                      onDragLeave={(e) => { e.preventDefault(); setIsDraggingPhotos(false); }}
                      onDrop={handleBulkDrop}
                    >
                      <div className="p-4 bg-gray-50 dark:bg-slate-800/50 border-b border-gray-200 dark:border-slate-800 flex justify-between items-center">
                        <h2 className="font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                          <Images size={20} /> Physical Reports
                        </h2>
                        {processingQueue.length > 0 && (
                          <span className="text-xs bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-200 px-2 py-1 rounded-full flex items-center gap-1 animate-pulse">
                            <Loader2 size={12} className="animate-spin" /> Processing {processingQueue.length} files...
                          </span>
                        )}
                      </div>

                      {/* Physical Data Search */}
                      {records.length > 0 && (
                        <div className="p-2 bg-white dark:bg-slate-900 border-b border-gray-200 dark:border-slate-800 sticky top-0 z-20">
                          <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                            <input 
                              type="text" 
                              placeholder="Search store, date or matched name..." 
                              className="w-full pl-9 pr-8 py-2 text-sm bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 border border-gray-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                              value={physicalSearch}
                              onChange={e => setPhysicalSearch(e.target.value)}
                            />
                            {physicalSearch && (
                              <button 
                                onClick={() => setPhysicalSearch('')}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                              >
                                <X size={14} />
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                      
                      <div className="flex-1 overflow-y-auto bg-slate-50/50 dark:bg-slate-950/50 flex flex-col">
                        {records.length === 0 ? (
                          <div className="flex-1 flex flex-col items-center justify-center text-gray-400 p-8">
                            <ArrowRight size={48} className="mb-4 text-gray-300 dark:text-gray-600" />
                            <p>Please upload the Excel file first</p>
                          </div>
                        ) : (
                          <>
                            {/* Bulk Drop Zone */}
                            <div className="p-4 bg-white dark:bg-slate-900 border-b border-gray-200 dark:border-slate-800 shadow-sm z-10">
                              <div className={`border-2 border-dashed rounded-xl p-6 flex flex-col items-center justify-center text-center transition-colors ${
                                  isDraggingPhotos 
                                    ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/20' 
                                    : 'border-gray-300 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/50 hover:bg-gray-100 dark:hover:bg-slate-800'
                              }`}>
                                  <div className="w-12 h-12 bg-purple-100 dark:bg-slate-700 text-purple-600 dark:text-purple-400 rounded-full flex items-center justify-center mb-3">
                                    <FileImage size={24} />
                                  </div>
                                  <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Drop Reports Here</h3>
                                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 mb-3">
                                    Drop one or multiple store report photos.<br/>
                                    AI will auto-match by Store Name AND Date.
                                  </p>
                                  <label className="cursor-pointer text-xs font-medium text-purple-600 dark:text-purple-400 bg-white dark:bg-slate-900 px-3 py-1.5 rounded border border-purple-200 dark:border-purple-900/30 shadow-sm hover:bg-purple-50 dark:hover:bg-purple-900/10 transition-colors">
                                    Select Photos
                                    <input 
                                      key={`bulk-photos-${resetKey}`}
                                      type="file" 
                                      multiple 
                                      className="hidden" 
                                      accept="image/*" 
                                      onClick={onInputClick}
                                      onChange={(e) => {
                                        if (e.target.files) {
                                          Array.from(e.target.files).forEach((f: File) => processImageFile(f));
                                          e.target.value = ''; // Reset bulk input
                                        }
                                      }} 
                                    />
                                  </label>
                              </div>
                            </div>

                            {/* Store List */}
                            <div className="p-4 space-y-3 flex-1 overflow-y-auto">
                              <div className="px-2 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider flex justify-between">
                                  <span>Analysis Status ({filteredPhysicalRecords.length})</span>
                                  <span>Manual Action</span>
                              </div>
                              {filteredPhysicalRecords.length === 0 && (
                                <div className="text-center py-8 text-gray-400 text-sm">No matches found for "{physicalSearch}"</div>
                              )}
                              {filteredPhysicalRecords.map(record => (
                                <StoreCard 
                                  key={record.id} 
                                  record={record} 
                                  onUploadImage={(id, file) => processImageFile(file, id)} 
                                />
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Reset Button (Dashboard) - Show if there are records OR an error message */}
                  {(records.length > 0 || error) && (
                    <div className="mt-6 flex justify-center animate-in fade-in slide-in-from-bottom-4 duration-500 pb-8 relative z-20">
                      <button 
                        type="button"
                        onClick={handleReset}
                        className="group flex items-center gap-2 px-6 py-3 bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 border border-gray-200 dark:border-slate-800 hover:border-red-200 dark:hover:border-red-900/50 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-full font-medium shadow-sm transition-all duration-300"
                      >
                        <Trash2 size={18} className="group-hover:scale-110 transition-transform duration-300" />
                        Reset & Clear All Data
                      </button>
                    </div>
                  )}
                </>
              )}
              
              {step === AppStep.EXPORT_PREVIEW && (
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 overflow-hidden flex flex-col h-[calc(100vh-220px)]">
                  <div className="overflow-auto flex-1">
                    {completedRecords.length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center text-gray-400 p-8">
                        <FileCheck size={48} className="mb-4 text-gray-300 dark:text-gray-600" />
                        <p className="text-lg font-medium text-gray-500 dark:text-gray-400">No Analysis Completed Yet</p>
                        <p className="text-sm mt-2">Please upload and analyze store reports in the dashboard first.</p>
                      </div>
                    ) : (
                      <table className="w-full text-sm text-left whitespace-nowrap">
                        <thead className="text-xs text-gray-700 dark:text-gray-300 uppercase bg-gray-100 dark:bg-slate-800 border-b dark:border-slate-700 sticky top-0 z-10">
                          <tr>
                            <th className="px-4 py-3 bg-gray-100 dark:bg-slate-800 sticky left-0 z-20 border-r dark:border-slate-700">Date</th>
                            <th className="px-4 py-3 bg-gray-100 dark:bg-slate-800 sticky left-[100px] z-20 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">Store</th>
                            
                            {/* Cash Group */}
                            <th className="px-4 py-3 text-right bg-blue-50/50 dark:bg-blue-900/10 border-l dark:border-slate-700">Phy Cash</th>
                            <th className="px-4 py-3 text-right bg-blue-50 dark:bg-blue-900/20 text-blue-900 dark:text-blue-100">Sys Cash</th>
                            <th className="px-4 py-3 text-right bg-blue-50/50 dark:bg-blue-900/10 font-bold text-gray-800 dark:text-gray-200">Diff</th>
                            
                            {/* UPI Group */}
                            <th className="px-4 py-3 text-right bg-purple-50/50 dark:bg-purple-900/10 border-l dark:border-slate-700">Phy UPI</th>
                            <th className="px-4 py-3 text-right bg-purple-50 dark:bg-purple-900/20 text-purple-900 dark:text-purple-100">Sys UPI</th>
                            <th className="px-4 py-3 text-right bg-purple-50/50 dark:bg-purple-900/10 font-bold text-gray-800 dark:text-gray-200">Diff</th>

                            {/* Card Group */}
                            <th className="px-4 py-3 text-right bg-orange-50/50 dark:bg-orange-900/10 border-l dark:border-slate-700">Phy Card</th>
                            <th className="px-4 py-3 text-right bg-orange-50 dark:bg-orange-900/20 text-orange-900 dark:text-orange-100">Sys Card</th>
                            <th className="px-4 py-3 text-right bg-orange-50/50 dark:bg-orange-900/10 font-bold text-gray-800 dark:text-gray-200">Diff</th>

                            {/* Sodexo Group */}
                            <th className="px-4 py-3 text-right bg-pink-50/50 dark:bg-pink-900/10 border-l dark:border-slate-700">Phy Sodexo</th>
                            <th className="px-4 py-3 text-right bg-pink-50 dark:bg-pink-900/20 text-pink-900 dark:text-pink-100">Sys Sodexo</th>
                            <th className="px-4 py-3 text-right bg-pink-50/50 dark:bg-pink-900/10 font-bold text-gray-800 dark:text-gray-200">Diff</th>

                            {/* Total Group */}
                            <th className="px-4 py-3 text-right bg-gray-200/50 dark:bg-slate-700/50 border-l border-gray-300 dark:border-slate-600">Phy Total</th>
                            <th className="px-4 py-3 text-right bg-gray-200 dark:bg-slate-700 text-gray-900 dark:text-white border-gray-300 dark:border-slate-600">Sys Total</th>
                            <th className="px-4 py-3 text-right bg-gray-200/50 dark:bg-slate-700/50 font-bold text-gray-900 dark:text-white border-gray-300 dark:border-slate-600">Total Diff</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                          {completedRecords.map(r => {
                            const phys = r.physical || { cashCount: 0, expenses: 0, upiMachineTotal: 0, cardMachineTotal: 0, sodexoTotal: 0, totalSales: 0 };
                            
                            const physicalNetCash = phys.cashCount + phys.expenses;
                            const cashDiff = physicalNetCash - r.system.cash;
                            
                            const upiDiff = phys.upiMachineTotal - r.system.upi;
                            
                            const cardDiff = phys.cardMachineTotal - r.system.card;
                            
                            const sodexoDiff = phys.sodexoTotal - r.system.sodexo;

                            // Always calculate total from components to ensure accuracy based on user request
                            const physicalTotalSales = physicalNetCash + phys.upiMachineTotal + phys.cardMachineTotal + phys.sodexoTotal;
                            const totalDiff = physicalTotalSales - r.system.totalSales;

                            return (
                              <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                                <td className="px-4 py-3 text-gray-600 dark:text-gray-400 sticky left-0 bg-white dark:bg-slate-900 border-r dark:border-slate-700 font-mono text-xs">{r.system.date}</td>
                                <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-200 sticky left-[100px] bg-white dark:bg-slate-900 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
                                  {r.storeName}
                                  {phys.extractedStoreName && (
                                    <div className="text-[10px] text-gray-400 font-normal">
                                      Matched: {phys.extractedStoreName}
                                    </div>
                                  )}
                                </td>
                                
                                {/* Cash */}
                                <td className="px-4 py-3 text-right font-medium text-blue-700 dark:text-blue-400 border-l dark:border-slate-800">{physicalNetCash.toLocaleString()}</td>
                                <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-400">{r.system.cash.toLocaleString()}</td>
                                <td className="px-4 py-3 text-right">
                                  <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                                    cashDiff === 0 ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 
                                    cashDiff > 0 ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                  }`}>
                                    {cashDiff === 0 ? 'OK' : (cashDiff > 0 ? `+${cashDiff}` : cashDiff)}
                                  </span>
                                </td>

                                {/* UPI */}
                                <td className="px-4 py-3 text-right font-medium text-purple-700 dark:text-purple-400 border-l dark:border-slate-800">{phys.upiMachineTotal.toLocaleString()}</td>
                                <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-400">{r.system.upi.toLocaleString()}</td>
                                <td className="px-4 py-3 text-right">
                                  <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                                    upiDiff === 0 ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                  }`}>
                                    {upiDiff === 0 ? 'OK' : (upiDiff > 0 ? `+${upiDiff}` : upiDiff)}
                                  </span>
                                </td>

                                {/* Card */}
                                <td className="px-4 py-3 text-right font-medium text-orange-700 dark:text-orange-400 border-l dark:border-slate-800">{phys.cardMachineTotal.toLocaleString()}</td>
                                <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-400">{r.system.card.toLocaleString()}</td>
                                <td className="px-4 py-3 text-right">
                                  <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                                    cardDiff === 0 ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                  }`}>
                                    {cardDiff === 0 ? 'OK' : (cardDiff > 0 ? `+${cardDiff}` : cardDiff)}
                                  </span>
                                </td>

                                {/* Sodexo */}
                                <td className="px-4 py-3 text-right font-medium text-pink-700 dark:text-pink-400 border-l dark:border-slate-800">{phys.sodexoTotal.toLocaleString()}</td>
                                <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-400">{r.system.sodexo.toLocaleString()}</td>
                                <td className="px-4 py-3 text-right">
                                  <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                                    sodexoDiff === 0 ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                  }`}>
                                    {sodexoDiff === 0 ? 'OK' : (sodexoDiff > 0 ? `+${sodexoDiff}` : sodexoDiff)}
                                  </span>
                                </td>

                                {/* Total Sales */}
                                <td className="px-4 py-3 text-right font-bold text-gray-900 dark:text-white border-l bg-gray-50 dark:bg-slate-800 dark:border-slate-800">{physicalTotalSales.toLocaleString()}</td>
                                <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-slate-800">{r.system.totalSales.toLocaleString()}</td>
                                <td className="px-4 py-3 text-right bg-gray-50 dark:bg-slate-800">
                                  <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                                    totalDiff === 0 ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 
                                    totalDiff > 0 ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                  }`}>
                                    {totalDiff === 0 ? 'MATCH' : (totalDiff > 0 ? `+${totalDiff}` : totalDiff)}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                  <div className="p-4 bg-gray-50 dark:bg-slate-800 border-t border-gray-200 dark:border-slate-700 flex justify-between items-center flex-shrink-0">
                      {/* Reset Button (Export Preview) */}
                      <button 
                        type="button"
                        onClick={handleReset}
                        className="flex items-center gap-2 text-slate-500 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                      >
                        <Trash2 size={16} /> Reset All Data
                      </button>

                      <button 
                        onClick={handleExport}
                        disabled={completedRecords.length === 0}
                        className={`flex items-center gap-2 text-white px-6 py-2.5 rounded-lg font-medium shadow-sm transition-all ${
                          completedRecords.length === 0 
                            ? 'bg-gray-400 dark:bg-slate-600 cursor-not-allowed' 
                            : 'bg-green-600 hover:bg-green-700 hover:shadow-md'
                        }`}
                      >
                        <Download size={18} /> Download Excel Report
                      </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
};

export default App;
