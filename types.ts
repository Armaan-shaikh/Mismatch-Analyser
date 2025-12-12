
export interface SystemData {
  storeName: string;
  date: string; // ISO Date string YYYY-MM-DD
  cash: number;
  upi: number;
  card: number;
  sodexo: number;
  bankTransfer: number;
  totalSales: number;
}

export interface PhysicalData {
  cashCount: number;
  expenses: number;
  upiMachineTotal: number;
  cardMachineTotal: number;
  sodexoTotal: number;
  totalSales?: number;
  extractedStoreName?: string;
  extractedDate?: string; // ISO Date string YYYY-MM-DD
}

export interface ReconciliationRecord {
  id: string;
  storeName: string;
  system: SystemData;
  physical: PhysicalData | null;
  status: 'pending' | 'processing' | 'completed' | 'error';
  rawImage?: string | null;
  errorMessage?: string;
}

export interface VarianceResult {
  cashDiff: number; // (Cash Count + Expenses) - System Cash
  upiDiff: number;  // Physical UPI - System UPI
  cardDiff: number; // Physical Card - System Card
  sodexoDiff: number; // Physical Sodexo - System Sodexo
  totalDiff: number;
  matches: boolean;
}

export enum AppStep {
  HOME = 0,
  DASHBOARD = 1,
  EXPORT_PREVIEW = 2,
}
