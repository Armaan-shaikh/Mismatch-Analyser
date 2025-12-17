
import { SystemData, ReconciliationRecord, VarianceResult } from "../types";

// We access the global XLSX variable loaded via CDN
declare const XLSX: any;

// Helper to convert Excel date serial or string to YYYY-MM-DD
const parseDate = (value: any): string => {
  if (!value) return new Date().toISOString().split('T')[0];

  // If it's a number (Excel serial date), convert to JS Date
  // Excel base date is Dec 30, 1899
  if (typeof value === 'number') {
    const date = new Date(Math.round((value - 25569) * 86400 * 1000));
    return date.toISOString().split('T')[0];
  }

  // If it's a string, try to parse it
  const date = new Date(value);
  if (!isNaN(date.getTime())) {
    return date.toISOString().split('T')[0];
  }

  return String(value);
};

export const parseSystemExcel = async (file: File): Promise<SystemData[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        
        // Convert to JSON with headers
        const jsonData: any[] = XLSX.utils.sheet_to_json(worksheet);
        
        // Map loose column names to our strict structure
        const mappedData: SystemData[] = jsonData.map((row) => {
          // Helper to find value case-insensitively
          const getVal = (keys: string[]) => {
            for (const k of Object.keys(row)) {
              if (keys.some(key => k.toLowerCase().includes(key.toLowerCase()))) {
                return parseFloat(row[k]) || 0;
              }
            }
            return 0;
          };

          // Find store name
          let storeName = "Unknown Store";
          const storeKey = Object.keys(row).find(k => k.toLowerCase().includes('store') || k.toLowerCase().includes('location'));
          if (storeKey) storeName = row[storeKey];

          // Find Date
          let dateStr = new Date().toISOString().split('T')[0];
          const dateKey = Object.keys(row).find(k => k.toLowerCase().includes('date') || k.toLowerCase().includes('day'));
          if (dateKey) {
            dateStr = parseDate(row[dateKey]);
          }

          return {
            storeName,
            date: dateStr,
            cash: getVal(['cash', 'hard cash']),
            upi: getVal(['upi', 'phonepe', 'gpay', 'paytm']),
            card: getVal(['card', 'pos', 'visa', 'mastercard']),
            sodexo: getVal(['sodexo', 'meal', 'pluxee', 'zeta']),
            bankTransfer: getVal(['bank', 'transfer', 'neft']),
            totalSales: getVal(['total', 'sales', 'grand total']),
          };
        });

        resolve(mappedData);
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = (error) => reject(error);
    reader.readAsArrayBuffer(file);
  });
};

export const generateReconciliationExcel = (records: ReconciliationRecord[]): void => {
  const exportData = records.map(record => {
    const sys = record.system;
    const phys = record.physical || { cashCount: 0, expenses: 0, upiMachineTotal: 0, cardMachineTotal: 0, sodexoTotal: 0, totalSales: 0 };
    
    // Calculate Variances
    const physicalNetCash = phys.cashCount + phys.expenses;
    const cashDiff = physicalNetCash - sys.cash;
    const upiDiff = phys.upiMachineTotal - sys.upi;
    const cardDiff = phys.cardMachineTotal - sys.card;
    const sodexoDiff = phys.sodexoTotal - sys.sodexo;
    
    // Use extracted total sales if available, otherwise sum the components
    const physicalTotalSales = physicalNetCash + phys.upiMachineTotal + phys.cardMachineTotal + phys.sodexoTotal;
    const totalDiff = physicalTotalSales - sys.totalSales;

    return {
      "Date": sys.date,
      "Store Name": sys.storeName,
      
      // CASH GROUP
      "Physical Cash (Count+Exp)": physicalNetCash,
      "System Cash": sys.cash,
      "Cash Difference": cashDiff,
      
      // UPI GROUP
      "Physical UPI": phys.upiMachineTotal,
      "System UPI": sys.upi,
      "UPI Difference": upiDiff,
      
      // CARD GROUP
      "Physical Card": phys.cardMachineTotal,
      "System Card": sys.card,
      "Card Difference": cardDiff,

      // SODEXO GROUP
      "Physical Sodexo": phys.sodexoTotal,
      "System Sodexo": sys.sodexo,
      "Sodexo Difference": sodexoDiff,

      // TOTAL SALES GROUP
      "Physical Total Sales": physicalTotalSales,
      "System Total Sales": sys.totalSales,
      "Total Difference": totalDiff,
      
      // Extra Info
      "System Bank Transfer": sys.bankTransfer,
    };
  });

  const worksheet = XLSX.utils.json_to_sheet(exportData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Reconciliation Report");
  
  // Generate filename
  XLSX.writeFile(workbook, `Reconciliation_Report_${new Date().toISOString().split('T')[0]}.xlsx`);
};
