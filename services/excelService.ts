
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
  const wb = XLSX.utils.book_new();
  const ws: any = {};
  
  // Define Headers
  const headers = ["Store Name", "Date", "Sales", "Cash", "UPI", "Card", "Sodexo", "Bank Tran", "Total"];
  
  // Write Headers to Row 0
  headers.forEach((h, i) => {
    const cellRef = XLSX.utils.encode_cell({ r: 0, c: i });
    ws[cellRef] = { v: h, t: 's' };
  });

  let currentRow = 1; // Start at row 2 (index 1)
  const merges: any[] = [];

  records.forEach(record => {
    const sys = record.system;
    const phys = record.physical || { cashCount: 0, expenses: 0, upiMachineTotal: 0, cardMachineTotal: 0, sodexoTotal: 0, totalSales: 0 };
    const phyNetCash = phys.cashCount + phys.expenses;

    const rPhy = currentRow;
    const rDiff = currentRow + 1;
    const rSys = currentRow + 2;

    // Excel Row Numbers (1-based, strictly for use in Formulas)
    const rowPhyNum = rPhy + 1;
    const rowDiffNum = rDiff + 1;
    const rowSysNum = rSys + 1;

    // --- Column A (0): Store Name ---
    const storeCell = XLSX.utils.encode_cell({ r: rPhy, c: 0 });
    ws[storeCell] = { v: sys.storeName, t: 's' };
    merges.push({ s: { r: rPhy, c: 0 }, e: { r: rSys, c: 0 } });

    // --- Column B (1): Date ---
    const dateCell = XLSX.utils.encode_cell({ r: rPhy, c: 1 });
    ws[dateCell] = { v: sys.date, t: 's' };
    merges.push({ s: { r: rPhy, c: 1 }, e: { r: rSys, c: 1 } });

    // --- Column C (2): Labels ---
    ws[XLSX.utils.encode_cell({ r: rPhy, c: 2 })] = { v: "Physical", t: 's' };
    ws[XLSX.utils.encode_cell({ r: rDiff, c: 2 })] = { v: "Difference", t: 's' };
    ws[XLSX.utils.encode_cell({ r: rSys, c: 2 })] = { v: "System", t: 's' };

    // --- Columns D-H (3-7): Data & Diff Formulas ---
    const columns = [
      { key: 'cash', phyVal: phyNetCash, sysVal: sys.cash, colIdx: 3, char: 'D' },
      { key: 'upi', phyVal: phys.upiMachineTotal, sysVal: sys.upi, colIdx: 4, char: 'E' },
      { key: 'card', phyVal: phys.cardMachineTotal, sysVal: sys.card, colIdx: 5, char: 'F' },
      { key: 'sodexo', phyVal: phys.sodexoTotal, sysVal: sys.sodexo, colIdx: 6, char: 'G' },
      { key: 'bank', phyVal: 0, sysVal: sys.bankTransfer, colIdx: 7, char: 'H' },
    ];

    columns.forEach(col => {
      // Physical Value
      ws[XLSX.utils.encode_cell({ r: rPhy, c: col.colIdx })] = { v: col.phyVal, t: 'n' };
      // System Value
      ws[XLSX.utils.encode_cell({ r: rSys, c: col.colIdx })] = { v: col.sysVal, t: 'n' };
      
      // Difference Formula: Physical (Top) - System (Bottom)
      ws[XLSX.utils.encode_cell({ r: rDiff, c: col.colIdx })] = { f: `${col.char}${rowPhyNum}-${col.char}${rowSysNum}`, t: 'n' };
    });

    // --- Column I (8): Total Formulas ---
    // Physical Total: SUM(D:H)
    ws[XLSX.utils.encode_cell({ r: rPhy, c: 8 })] = { f: `SUM(D${rowPhyNum}:H${rowPhyNum})`, t: 'n' };
    
    // System Total: SUM(D:H)
    ws[XLSX.utils.encode_cell({ r: rSys, c: 8 })] = { f: `SUM(D${rowSysNum}:H${rowSysNum})`, t: 'n' };
    
    // Difference Total: I_phy - I_sys
    ws[XLSX.utils.encode_cell({ r: rDiff, c: 8 })] = { f: `I${rowPhyNum}-I${rowSysNum}`, t: 'n' };

    // Move down 4 rows (3 data + 1 gap)
    currentRow += 4;
  });

  // Set Sheet Range
  const range = { s: { c: 0, r: 0 }, e: { c: 8, r: currentRow - 1 } };
  ws['!ref'] = XLSX.utils.encode_range(range);
  ws['!merges'] = merges;
  ws['!cols'] = [
    { wch: 20 }, // Store Name
    { wch: 12 }, // Date
    { wch: 12 }, // Label
    { wch: 10 }, // Cash
    { wch: 10 }, // UPI
    { wch: 10 }, // Card
    { wch: 10 }, // Sodexo
    { wch: 10 }, // Bank
    { wch: 12 }, // Total
  ];

  XLSX.utils.book_append_sheet(wb, ws, "Reconciliation Report");
  XLSX.writeFile(wb, `Reconciliation_Report_${new Date().toISOString().split('T')[0]}.xlsx`);
};
