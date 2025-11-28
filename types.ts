
export enum PaymentMethod {
  CASH = 'Dinheiro',
  CARD = 'Cartão',
  DEBT = 'Crediário (Fiado)'
}

export interface Product {
  id: string;
  name: string;
  price: number; // Selling price
  cost: number; // Cost price
  barcode?: string;
  stock: number;
  unit: 'un' | 'kg';
}

export interface Client {
  id: string;
  name: string;
  phone?: string;
  balance: number; // Positive means they have credit, Negative means they owe money
  cpf?: string;
  address?: string;
}

export interface CartItem extends Product {
  quantity: number;
  subtotal: number;
}

export interface Sale {
  id: string;
  date: string; // ISO string
  clientId: string;
  clientName: string; // Snapshot
  items: CartItem[];
  total: number;
  paymentMethod: PaymentMethod;
  amountPaid: number; // For cash
  change: number; // For cash
}

export interface StoreDebt {
  id: string;
  title: string; // e.g., "Electricity Bill", "MEI"
  amount: number;
  dueDate: string;
  isPaid: boolean;
  isRecurring: boolean;
  proofImage?: string; // Base64
}

export interface AppState {
  products: Product[];
  clients: Client[];
  sales: Sale[];
  storeDebts: StoreDebt[];
}

export type View = 'LOGIN' | 'POS' | 'INVENTORY' | 'CLIENTS' | 'FINANCIAL' | 'REPORTS' | 'REGISTRATION';
