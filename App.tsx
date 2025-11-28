
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Menu, User, Plus, Search, ScanBarcode, Check, 
  Trash2, X, DollarSign, CreditCard, NotebookPen, 
  BarChart3, Settings, Package, FileText, Camera,
  LogOut, ArrowLeft, Download, ShoppingBag, UserPlus
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { 
  AppState, Product, Sale, Client, PaymentMethod, 
  CartItem, View, StoreDebt 
} from './types';
import { analyzeInvoiceImage, identifyProductFromImage, readBarcodeFromImage } from './services/geminiService';
import { CameraModal } from './components/CameraModal';

// --- MOCK DATA / INITIAL STATE ---
const INITIAL_STATE: AppState = {
  products: [
    { id: '1', name: 'Coca Cola 2L', price: 12.00, cost: 7.50, stock: 24, unit: 'un', barcode: '7894900011517' },
    { id: '2', name: 'Pão Francês (kg)', price: 15.90, cost: 8.00, stock: 50, unit: 'kg' },
    { id: '3', name: 'Detergente Ypê', price: 2.99, cost: 1.80, stock: 100, unit: 'un' },
  ],
  clients: [
    { id: '0', name: 'NI (Não Identificado)', balance: 0 },
    { id: '1', name: 'João Silva', balance: -50.00, phone: '1199999999', address: 'Rua A, 123', cpf: '000.000.000-00' },
    { id: '2', name: 'Maria Souza', balance: 0, phone: '1188888888' },
  ],
  sales: [],
  storeDebts: [
    { id: '1', title: 'DAS MEI', amount: 76.00, dueDate: '2023-11-20', isPaid: false, isRecurring: true },
    { id: '2', title: 'Luz (Enel)', amount: 250.00, dueDate: '2023-11-15', isPaid: true, isRecurring: false },
  ]
};

// --- HELPER HOOK FOR LOCALSTORAGE ---
function useStickyState<T>(defaultValue: T, key: string): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    const stickyValue = window.localStorage.getItem(key);
    return stickyValue !== null ? JSON.parse(stickyValue) : defaultValue;
  });
  useEffect(() => {
    window.localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);
  return [value, setValue];
}

const App: React.FC = () => {
  // Global State
  const [products, setProducts] = useStickyState<Product[]>(INITIAL_STATE.products, 'av_products');
  const [clients, setClients] = useStickyState<Client[]>(INITIAL_STATE.clients, 'av_clients');
  const [sales, setSales] = useStickyState<Sale[]>(INITIAL_STATE.sales, 'av_sales');
  const [storeDebts, setStoreDebts] = useStickyState<StoreDebt[]>(INITIAL_STATE.storeDebts, 'av_debts');
  
  // UI State
  const [currentView, setCurrentView] = useState<View>('LOGIN');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // POS State
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string>('0');
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // Camera State
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [cameraMode, setCameraMode] = useState<'PRODUCT_SCAN' | 'INVOICE_SCAN' | 'BARCODE_SCAN'>('PRODUCT_SCAN');
  // Callback to return data from camera to specific components
  const [onCameraCapture, setOnCameraCapture] = useState<((base64: string) => void) | null>(null);

  // --- ACTIONS ---

  const handleLogin = (pin: string) => {
    if (pin === '1234') setCurrentView('POS');
    else alert('PIN Incorreto (Use 1234)');
  };

  const addToCart = (product: Product, quantity: number = 1) => {
    setCart(prev => {
      const existing = prev.find(item => item.id === product.id);
      if (existing) {
        return prev.map(item => item.id === product.id 
          ? { ...item, quantity: item.quantity + quantity, subtotal: (item.quantity + quantity) * item.price } 
          : item
        );
      }
      return [...prev, { ...product, quantity, subtotal: product.price * quantity }];
    });
    setSearchTerm('');
  };

  const removeFromCart = (id: string) => {
    setCart(prev => prev.filter(item => item.id !== id));
  };

  const cartTotal = useMemo(() => cart.reduce((acc, item) => acc + item.subtotal, 0), [cart]);

  const handleCheckout = (method: PaymentMethod, paidAmount: number = 0) => {
    const total = cartTotal;
    const change = method === PaymentMethod.CASH ? paidAmount - total : 0;
    
    if (method === PaymentMethod.CASH && paidAmount < total) {
      alert("Valor insuficiente!");
      return;
    }

    const newSale: Sale = {
      id: Date.now().toString(),
      date: new Date().toISOString(),
      clientId: selectedClientId,
      clientName: clients.find(c => c.id === selectedClientId)?.name || 'NI',
      items: [...cart],
      total,
      paymentMethod: method,
      amountPaid: paidAmount,
      change
    };

    // Update stock
    const newProducts = products.map(p => {
      const cartItem = cart.find(c => c.id === p.id);
      if (cartItem) return { ...p, stock: p.stock - cartItem.quantity };
      return p;
    });
    setProducts(newProducts);

    // Update Client Debt if Crediário
    if (method === PaymentMethod.DEBT) {
      const newClients = clients.map(c => {
        if (c.id === selectedClientId) return { ...c, balance: c.balance - total };
        return c;
      });
      setClients(newClients);
    }

    setSales(prev => [...prev, newSale]);
    setCart([]);
    setIsPaymentModalOpen(false);
    setSelectedClientId('0');
    alert("Venda realizada com sucesso!");
  };

  const handleProcessInvoice = async (base64: string) => {
    setIsLoading(true);
    try {
      const data = await analyzeInvoiceImage(base64);
      if (data && data.items) {
        alert(`Nota processada! Encontrados ${data.items.length} itens. Total: R$ ${data.total}`);
        
        // Auto-update price logic (simplified)
        let updatedCount = 0;
        const newProducts = [...products];
        data.items.forEach((item: any) => {
            const existing = newProducts.find(p => p.name.toLowerCase().includes(item.name.toLowerCase()));
            if (existing) {
                existing.cost = item.cost; 
                existing.stock += item.quantity;
                updatedCount++;
            } else {
                newProducts.push({
                    id: Date.now().toString() + Math.random(),
                    name: item.name,
                    cost: item.cost,
                    price: item.cost * 1.5,
                    stock: item.quantity,
                    unit: 'un'
                });
                updatedCount++;
            }
        });
        setProducts(newProducts);
        
        setStoreDebts(prev => [...prev, {
            id: Date.now().toString(),
            title: `Compra (Nota ${data.date || 'Hoje'})`,
            amount: data.total || 0,
            dueDate: new Date().toISOString(), 
            isPaid: false,
            isRecurring: false,
            proofImage: base64
        }]);

        if (updatedCount > 0) {
            alert("Estoque e custos atualizados com sucesso!");
        }
      }
    } catch (e) {
      alert("Falha ao processar nota.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleProductScan = async (base64: string) => {
     setIsLoading(true);
     try {
         // First try to check if it's a barcode
         const barcode = await readBarcodeFromImage(base64);
         let productFound = null;

         if (barcode) {
             productFound = products.find(p => p.barcode === barcode);
             if (productFound) {
                 addToCart(productFound);
                 setIsLoading(false);
                 return;
             }
         }

         // If not found by barcode or no barcode, identify visually
         const data = await identifyProductFromImage(base64);
         if (data) {
             setSearchTerm(data.name || "");
             const existing = products.find(p => p.name.toLowerCase() === data.name.toLowerCase());
             if (existing) addToCart(existing);
             else {
                 if(window.confirm(`Produto não encontrado: ${data.name}. Deseja cadastrar?`)) {
                    const newProd: Product = {
                        id: Date.now().toString(),
                        name: data.name,
                        price: data.estimatedPrice || 0,
                        cost: (data.estimatedPrice || 0) * 0.6,
                        stock: 1,
                        unit: 'un',
                        barcode: barcode || undefined // Use barcode if found earlier
                    };
                    setProducts(prev => [...prev, newProd]);
                    addToCart(newProd);
                 }
             }
         } else {
             alert("Não foi possível identificar o produto.");
         }
     } catch(e) {
         console.error(e);
     } finally {
         setIsLoading(false);
     }
  }

  // --- VIEWS ---

  if (currentView === 'LOGIN') {
    return <LoginView onLogin={handleLogin} />;
  }

  const renderView = () => {
    switch (currentView) {
      case 'POS': return (
        <POSView 
          products={products} 
          cart={cart} 
          clients={clients}
          selectedClientId={selectedClientId}
          onSelectClient={setSelectedClientId}
          onAddToCart={addToCart} 
          onRemoveFromCart={removeFromCart}
          onCheckout={() => setIsPaymentModalOpen(true)}
          total={cartTotal}
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          onScanRequest={() => { setCameraMode('PRODUCT_SCAN'); setIsCameraOpen(true); }}
        />
      );
      case 'FINANCIAL': return (
         <FinancialView 
            clients={clients} 
            debts={storeDebts} 
            sales={sales}
            onUpdateClientBalance={(id, amount) => {
                setClients(prev => prev.map(c => c.id === id ? {...c, balance: c.balance + amount} : c));
                alert("Pagamento registrado!");
            }}
            onAddDebt={(debt) => setStoreDebts(prev => [...prev, debt])}
            onPayDebt={(id) => {
                setStoreDebts(prev => prev.map(d => d.id === id ? {...d, isPaid: true} : d));
            }}
            onScanInvoiceRequest={() => { setCameraMode('INVOICE_SCAN'); setIsCameraOpen(true); }}
         />
      );
      case 'INVENTORY': return (
          <InventoryView 
            products={products}
            onUpdateProduct={(p) => setProducts(prev => prev.map(prod => prod.id === p.id ? p : prod))}
            onScanInvoiceRequest={() => { setCameraMode('INVOICE_SCAN'); setIsCameraOpen(true); }}
            onDownloadTags={() => {
                const text = products.map(p => `${p.name}: R$ ${p.price.toFixed(2)}`).join('\n');
                const element = document.createElement("a");
                const file = new Blob([text], {type: 'text/plain'});
                element.href = URL.createObjectURL(file);
                element.download = "etiquetas_atualizadas.txt";
                document.body.appendChild(element);
                element.click();
            }}
          />
      );
      case 'REPORTS': return <ReportsView sales={sales} />;
      case 'REGISTRATION': return (
        <RegistrationView 
            onSaveClient={(client) => {
                setClients(prev => [...prev, client]);
                alert("Cliente cadastrado!");
            }}
            onSaveProduct={(product) => {
                setProducts(prev => [...prev, product]);
                alert("Produto cadastrado!");
            }}
            onScanBarcodeRequest={(callback) => {
                setCameraMode('BARCODE_SCAN');
                setOnCameraCapture(() => callback);
                setIsCameraOpen(true);
            }}
        />
      );
      default: return <div>Em construção</div>;
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gray-100 overflow-hidden font-sans">
      {/* Sidebar Overlay */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 transition-opacity"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 w-64 bg-brand-900 text-white z-50 transform transition-transform duration-300 ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="p-6 border-b border-brand-600 flex justify-between items-center">
          <h2 className="text-xl font-bold">Menu</h2>
          <button onClick={() => setIsSidebarOpen(false)}><X /></button>
        </div>
        <nav className="p-4 space-y-2">
          <SidebarItem icon={<ShoppingBag />} label="Venda (PDV)" onClick={() => { setCurrentView('POS'); setIsSidebarOpen(false); }} active={currentView === 'POS'} />
          <SidebarItem icon={<Package />} label="Estoque & Compras" onClick={() => { setCurrentView('INVENTORY'); setIsSidebarOpen(false); }} active={currentView === 'INVENTORY'} />
          <SidebarItem icon={<DollarSign />} label="Financeiro & Dívidas" onClick={() => { setCurrentView('FINANCIAL'); setIsSidebarOpen(false); }} active={currentView === 'FINANCIAL'} />
          <SidebarItem icon={<BarChart3 />} label="Relatórios" onClick={() => { setCurrentView('REPORTS'); setIsSidebarOpen(false); }} active={currentView === 'REPORTS'} />
          <SidebarItem icon={<UserPlus />} label="Cadastros" onClick={() => { setCurrentView('REGISTRATION'); setIsSidebarOpen(false); }} active={currentView === 'REGISTRATION'} />
          <div className="pt-8 border-t border-brand-600 mt-4">
            <SidebarItem icon={<LogOut />} label="Sair" onClick={() => setCurrentView('LOGIN')} />
          </div>
        </nav>
      </aside>

      {/* Main Layout */}
      <header className="bg-brand-600 text-white h-14 flex items-center px-4 shadow-md flex-shrink-0">
        <button onClick={() => setIsSidebarOpen(true)} className="p-2 -ml-2 hover:bg-brand-500 rounded-full">
          <Menu />
        </button>
        <h1 className="ml-4 font-semibold text-lg flex-1">
            {currentView === 'POS' ? 'Automatize Vendas' : 
             currentView === 'FINANCIAL' ? 'Financeiro' : 
             currentView === 'INVENTORY' ? 'Estoque' : 
             currentView === 'REGISTRATION' ? 'Cadastros' : 'Relatórios'}
        </h1>
      </header>

      <main className="flex-1 overflow-hidden relative">
        {renderView()}
      </main>

      {/* Global Loading Overlay */}
      {isLoading && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex flex-col items-center justify-center text-white">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mb-4"></div>
          <p>Processando...</p>
        </div>
      )}

      {/* Modals */}
      {isPaymentModalOpen && (
        <PaymentModal 
          total={cartTotal} 
          onClose={() => setIsPaymentModalOpen(false)} 
          onConfirm={handleCheckout} 
        />
      )}
      
      <CameraModal 
        isOpen={isCameraOpen}
        onClose={() => {
            setIsCameraOpen(false);
            setOnCameraCapture(null);
        }}
        onCapture={async (img) => {
            if (onCameraCapture) {
                // Specialized one-off capture (e.g. registration barcode)
                setIsLoading(true);
                try {
                    const barcode = await readBarcodeFromImage(img);
                    if (barcode) {
                        onCameraCapture(barcode);
                    } else {
                        alert("Não foi possível ler o código de barras.");
                    }
                } finally {
                    setIsLoading(false);
                }
            } else {
                // Default flows
                if (cameraMode === 'INVOICE_SCAN') handleProcessInvoice(img);
                else handleProductScan(img);
            }
        }}
        label={cameraMode === 'INVOICE_SCAN' ? 'Fotografar Nota Fiscal' : cameraMode === 'BARCODE_SCAN' ? 'Fotografar Código de Barras' : 'Escanear Produto'}
      />
    </div>
  );
};

// --- SUB-COMPONENTS ---

const SidebarItem: React.FC<{ icon: React.ReactNode, label: string, onClick: () => void, active?: boolean }> = ({ icon, label, onClick, active }) => (
  <button 
    onClick={onClick}
    className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors ${active ? 'bg-brand-500 text-white' : 'text-brand-100 hover:bg-brand-800'}`}
  >
    {icon}
    <span>{label}</span>
  </button>
);

const LoginView: React.FC<{ onLogin: (p: string) => void }> = ({ onLogin }) => {
  const [pin, setPin] = useState('');
  return (
    <div className="flex flex-col items-center justify-center h-screen bg-brand-900 text-white p-6">
      <div className="mb-8 flex flex-col items-center">
        <div className="w-20 h-20 bg-white rounded-2xl flex items-center justify-center text-brand-600 mb-4">
           <ShoppingBag size={40} />
        </div>
        <h1 className="text-3xl font-bold">Automatize</h1>
        <h2 className="text-xl font-light opacity-80">Vendas</h2>
      </div>
      <div className="w-full max-w-xs space-y-4">
        <input 
          type="password" 
          maxLength={4}
          placeholder="PIN (1234)" 
          className="w-full text-center text-3xl tracking-widest p-4 rounded-xl bg-brand-800 border border-brand-600 focus:outline-none focus:border-brand-400 placeholder-brand-600/50"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
        />
        <button 
          onClick={() => onLogin(pin)}
          className="w-full bg-brand-500 hover:bg-brand-400 text-white py-4 rounded-xl font-bold text-lg shadow-lg transition-transform active:scale-95"
        >
          ENTRAR
        </button>
      </div>
    </div>
  );
};

const RegistrationView: React.FC<{ onSaveClient: (c: Client) => void, onSaveProduct: (p: Product) => void, onScanBarcodeRequest: (cb: (code: string) => void) => void }> = ({ onSaveClient, onSaveProduct, onScanBarcodeRequest }) => {
    const [tab, setTab] = useState<'CLIENT' | 'PRODUCT'>('CLIENT');

    // Client Form State
    const [cName, setCName] = useState('');
    const [cCpf, setCCpf] = useState('');
    const [cPhone, setCPhone] = useState('');
    const [cAddress, setCAddress] = useState('');

    // Product Form State
    const [pName, setPName] = useState('');
    const [pBarcode, setPBarcode] = useState('');
    const [pUnit, setPUnit] = useState<'un' | 'kg'>('un');
    const [pPrice, setPPrice] = useState('');
    const [pCost, setPCost] = useState('');
    const [pStock, setPStock] = useState('');

    const handleSaveClient = () => {
        if (!cName) return alert('Nome é obrigatório');
        onSaveClient({
            id: Date.now().toString(),
            name: cName,
            cpf: cCpf,
            address: cAddress,
            phone: cPhone,
            balance: 0
        });
        setCName(''); setCCpf(''); setCPhone(''); setCAddress('');
    };

    const handleSaveProduct = () => {
        if (!pName || !pPrice || !pStock) return alert('Preencha os campos obrigatórios');
        
        let barcode = pBarcode.trim();
        if (!barcode) {
            // Generate 4 digit random code
            barcode = Math.floor(1000 + Math.random() * 9000).toString();
        }

        onSaveProduct({
            id: Date.now().toString(),
            name: pName,
            barcode,
            unit: pUnit,
            price: parseFloat(pPrice),
            cost: parseFloat(pCost) || 0,
            stock: parseFloat(pStock)
        });
        setPName(''); setPBarcode(''); setPPrice(''); setPCost(''); setPStock('');
    };

    return (
        <div className="flex flex-col h-full bg-gray-50">
            <div className="flex bg-white shadow-sm mb-4">
                <button 
                    onClick={() => setTab('CLIENT')} 
                    className={`flex-1 py-4 text-center font-medium border-b-2 ${tab === 'CLIENT' ? 'border-brand-500 text-brand-600' : 'border-transparent text-gray-500'}`}
                >
                    Cliente
                </button>
                <button 
                    onClick={() => setTab('PRODUCT')} 
                    className={`flex-1 py-4 text-center font-medium border-b-2 ${tab === 'PRODUCT' ? 'border-brand-500 text-brand-600' : 'border-transparent text-gray-500'}`}
                >
                    Produto
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
                <div className="bg-white p-6 rounded-lg shadow-sm">
                    {tab === 'CLIENT' ? (
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Nome *</label>
                                <input className="w-full p-3 border rounded-lg" value={cName} onChange={e => setCName(e.target.value)} placeholder="Ex: Maria Silva" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">CPF</label>
                                <input className="w-full p-3 border rounded-lg" value={cCpf} onChange={e => setCCpf(e.target.value)} placeholder="000.000.000-00" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Endereço</label>
                                <input className="w-full p-3 border rounded-lg" value={cAddress} onChange={e => setCAddress(e.target.value)} placeholder="Rua, Número, Bairro" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Telefone</label>
                                <input className="w-full p-3 border rounded-lg" value={cPhone} onChange={e => setCPhone(e.target.value)} placeholder="(00) 00000-0000" />
                            </div>
                            <button onClick={handleSaveClient} className="w-full bg-brand-600 text-white font-bold py-3 rounded-lg mt-4">
                                CADASTRAR CLIENTE
                            </button>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Nome do Produto *</label>
                                <input className="w-full p-3 border rounded-lg" value={pName} onChange={e => setPName(e.target.value)} placeholder="Ex: Arroz 5kg" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Código de Barras</label>
                                <div className="flex space-x-2">
                                    <input className="flex-1 p-3 border rounded-lg" value={pBarcode} onChange={e => setPBarcode(e.target.value)} placeholder="Deixe em branco para gerar auto" />
                                    <button onClick={() => onScanBarcodeRequest((code) => setPBarcode(code))} className="bg-gray-100 p-3 rounded-lg text-gray-600">
                                        <Camera />
                                    </button>
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Unidade</label>
                                <div className="flex space-x-4">
                                    <label className="flex items-center space-x-2 border p-3 rounded-lg flex-1">
                                        <input type="radio" checked={pUnit === 'un'} onChange={() => setPUnit('un')} />
                                        <span>Unidade (un)</span>
                                    </label>
                                    <label className="flex items-center space-x-2 border p-3 rounded-lg flex-1">
                                        <input type="radio" checked={pUnit === 'kg'} onChange={() => setPUnit('kg')} />
                                        <span>Quilo (kg)</span>
                                    </label>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Preço Venda *</label>
                                    <input type="number" className="w-full p-3 border rounded-lg" value={pPrice} onChange={e => setPPrice(e.target.value)} placeholder="0.00" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Custo</label>
                                    <input type="number" className="w-full p-3 border rounded-lg" value={pCost} onChange={e => setPCost(e.target.value)} placeholder="0.00" />
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Estoque Inicial *</label>
                                <input type="number" className="w-full p-3 border rounded-lg" value={pStock} onChange={e => setPStock(e.target.value)} placeholder="0" />
                            </div>
                            <button onClick={handleSaveProduct} className="w-full bg-brand-600 text-white font-bold py-3 rounded-lg mt-4">
                                CADASTRAR PRODUTO
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

const POSView: React.FC<{
  products: Product[],
  cart: CartItem[],
  clients: Client[],
  selectedClientId: string,
  onSelectClient: (id: string) => void,
  onAddToCart: (p: Product, q?: number) => void,
  onRemoveFromCart: (id: string) => void,
  onCheckout: () => void,
  total: number,
  searchTerm: string,
  setSearchTerm: (s: string) => void,
  onScanRequest: () => void
}> = ({ products, cart, clients, selectedClientId, onSelectClient, onAddToCart, onRemoveFromCart, onCheckout, total, searchTerm, setSearchTerm, onScanRequest }) => {
  
  const filteredProducts = useMemo(() => {
    if (!searchTerm) return [];
    const lower = searchTerm.toLowerCase();
    return products.filter(p => p.name.toLowerCase().includes(lower) || p.barcode?.includes(lower));
  }, [products, searchTerm]);

  return (
    <div className="flex flex-col h-full">
      {/* Top Bar: Client & Search */}
      <div className="bg-white p-3 shadow-sm space-y-3 z-10">
        <div className="flex items-center space-x-2 bg-gray-100 p-2 rounded-lg">
           <User size={18} className="text-gray-500" />
           <select 
             className="bg-transparent flex-1 outline-none text-sm font-medium"
             value={selectedClientId}
             onChange={(e) => onSelectClient(e.target.value)}
           >
             {clients.map(c => (
               <option key={c.id} value={c.id}>{c.name}</option>
             ))}
           </select>
        </div>
        
        <div className="flex space-x-2">
          <div className="flex-1 flex items-center bg-gray-100 rounded-lg px-3">
             <Search size={18} className="text-gray-400" />
             <input 
               placeholder="Buscar ou escanear..." 
               className="bg-transparent flex-1 p-3 outline-none"
               value={searchTerm}
               onChange={(e) => setSearchTerm(e.target.value)}
             />
          </div>
          <button 
             onClick={onScanRequest}
             className="bg-brand-100 text-brand-700 p-3 rounded-lg"
          >
             <ScanBarcode />
          </button>
        </div>

        {/* Search Results Dropdown (Absolute) */}
        {searchTerm && filteredProducts.length > 0 && (
           <div className="absolute top-36 left-0 right-0 bg-white shadow-xl z-20 max-h-60 overflow-y-auto mx-4 rounded-lg border">
             {filteredProducts.map(p => (
               <div 
                 key={p.id} 
                 onClick={() => onAddToCart(p)}
                 className="p-3 border-b flex justify-between items-center active:bg-gray-50"
               >
                 <div>
                   <div className="font-medium">{p.name}</div>
                   <div className="text-xs text-gray-500">Estoque: {p.stock}</div>
                 </div>
                 <div className="font-bold text-brand-600">R$ {p.price.toFixed(2)}</div>
               </div>
             ))}
           </div>
        )}
      </div>

      {/* Cart List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50">
        {cart.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-gray-400 opacity-50">
            <ShoppingBag size={48} className="mb-2" />
            <p>Carrinho vazio</p>
          </div>
        ) : (
          cart.map(item => (
            <div key={item.id} className="bg-white p-3 rounded-lg shadow-sm flex justify-between items-center">
               <div className="flex-1">
                 <div className="font-medium text-gray-800">{item.name}</div>
                 <div className="text-sm text-gray-500">
                    {item.quantity} {item.unit} x R$ {item.price.toFixed(2)}
                 </div>
               </div>
               <div className="flex items-center space-x-3">
                 <span className="font-bold text-gray-900">R$ {item.subtotal.toFixed(2)}</span>
                 <button onClick={() => onRemoveFromCart(item.id)} className="text-red-400 p-1">
                   <Trash2 size={18} />
                 </button>
               </div>
            </div>
          ))
        )}
      </div>

      {/* Footer Totals */}
      <div className="bg-white border-t p-4 pb-8 safe-area-bottom">
        <div className="flex justify-between items-end mb-4">
           <span className="text-gray-500 font-medium">Total a Pagar</span>
           <span className="text-3xl font-bold text-brand-600">R$ {total.toFixed(2)}</span>
        </div>
        <button 
          onClick={onCheckout}
          disabled={cart.length === 0}
          className="w-full bg-brand-600 text-white font-bold text-lg py-4 rounded-xl shadow-lg disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] transition-transform"
        >
          FECHAR VENDA
        </button>
      </div>
    </div>
  );
};

const PaymentModal: React.FC<{ total: number, onClose: () => void, onConfirm: (m: PaymentMethod, amt?: number) => void }> = ({ total, onClose, onConfirm }) => {
  const [method, setMethod] = useState<PaymentMethod>(PaymentMethod.CASH);
  const [amountPaid, setAmountPaid] = useState<string>('');
  
  const change = method === PaymentMethod.CASH && amountPaid ? parseFloat(amountPaid) - total : 0;

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center">
      <div className="bg-white w-full max-w-md rounded-t-2xl sm:rounded-2xl p-6 animate-slide-up">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xl font-bold">Pagamento</h3>
          <button onClick={onClose}><X /></button>
        </div>
        
        <div className="grid grid-cols-3 gap-3 mb-6">
          {[
            { id: PaymentMethod.CASH, icon: <DollarSign />, label: 'Dinheiro' },
            { id: PaymentMethod.CARD, icon: <CreditCard />, label: 'Cartão' },
            { id: PaymentMethod.DEBT, icon: <NotebookPen />, label: 'Fiado' }
          ].map(m => (
            <button 
              key={m.id}
              onClick={() => setMethod(m.id)}
              className={`flex flex-col items-center justify-center p-3 rounded-xl border-2 transition-all ${method === m.id ? 'border-brand-500 bg-brand-50 text-brand-600' : 'border-gray-100 text-gray-500'}`}
            >
              {m.icon}
              <span className="text-xs mt-1 font-medium">{m.label}</span>
            </button>
          ))}
        </div>

        <div className="space-y-4 mb-6">
          <div className="flex justify-between text-lg font-medium">
            <span>Total</span>
            <span>R$ {total.toFixed(2)}</span>
          </div>
          
          {method === PaymentMethod.CASH && (
            <>
               <div>
                 <label className="text-xs text-gray-500 block mb-1">Valor Recebido</label>
                 <input 
                   type="number" 
                   autoFocus
                   className="w-full text-xl font-bold p-3 bg-gray-50 rounded-lg border focus:border-brand-500 outline-none"
                   placeholder="0.00"
                   value={amountPaid}
                   onChange={e => setAmountPaid(e.target.value)}
                 />
               </div>
               {change >= 0 && (
                 <div className="flex justify-between text-lg font-medium text-green-600">
                    <span>Troco</span>
                    <span>R$ {change.toFixed(2)}</span>
                 </div>
               )}
            </>
          )}
        </div>

        <button 
          onClick={() => onConfirm(method, parseFloat(amountPaid) || 0)}
          className="w-full bg-green-600 text-white font-bold py-4 rounded-xl shadow-md active:scale-95 transition-transform"
        >
          CONFIRMAR
        </button>
      </div>
    </div>
  );
};

const FinancialView: React.FC<{ 
    clients: Client[], 
    debts: StoreDebt[], 
    sales: Sale[],
    onUpdateClientBalance: (id: string, amt: number) => void,
    onAddDebt: (d: StoreDebt) => void,
    onPayDebt: (id: string) => void,
    onScanInvoiceRequest: () => void
}> = ({ clients, debts, sales, onUpdateClientBalance, onAddDebt, onPayDebt, onScanInvoiceRequest }) => {
    const [tab, setTab] = useState<'RECEIVABLES' | 'PAYABLES'>('RECEIVABLES');
    
    // Receivables
    const debtors = clients.filter(c => c.balance < 0);
    const totalReceivable = debtors.reduce((acc, c) => acc + Math.abs(c.balance), 0);

    // Payables
    const unpaidDebts = debts.filter(d => !d.isPaid);
    const totalPayable = unpaidDebts.reduce((acc, d) => acc + d.amount, 0);

    return (
        <div className="flex flex-col h-full bg-gray-50">
            <div className="flex bg-white shadow-sm mb-4">
                <button 
                    onClick={() => setTab('RECEIVABLES')} 
                    className={`flex-1 py-4 text-center font-medium border-b-2 ${tab === 'RECEIVABLES' ? 'border-brand-500 text-brand-600' : 'border-transparent text-gray-500'}`}
                >
                    A Receber (R$ {totalReceivable.toFixed(2)})
                </button>
                <button 
                    onClick={() => setTab('PAYABLES')} 
                    className={`flex-1 py-4 text-center font-medium border-b-2 ${tab === 'PAYABLES' ? 'border-red-500 text-red-600' : 'border-transparent text-gray-500'}`}
                >
                    A Pagar (R$ {totalPayable.toFixed(2)})
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {tab === 'RECEIVABLES' && (
                    <>
                        {debtors.length === 0 ? <p className="text-center text-gray-400 mt-10">Ninguém devendo! 🎉</p> :
                        debtors.map(c => (
                            <div key={c.id} className="bg-white p-4 rounded-lg shadow-sm border-l-4 border-orange-400 flex justify-between items-center">
                                <div>
                                    <div className="font-bold">{c.name}</div>
                                    <div className="text-sm text-gray-500">{c.phone || 'Sem telefone'}</div>
                                    <div className="text-red-500 font-medium mt-1">Deve: R$ {Math.abs(c.balance).toFixed(2)}</div>
                                </div>
                                <button 
                                    onClick={() => {
                                        const amt = prompt(`Quanto ${c.name} vai pagar?`, Math.abs(c.balance).toString());
                                        if (amt) onUpdateClientBalance(c.id, parseFloat(amt));
                                    }}
                                    className="bg-green-100 text-green-700 px-4 py-2 rounded-lg font-medium text-sm"
                                >
                                    Receber
                                </button>
                            </div>
                        ))}
                    </>
                )}

                {tab === 'PAYABLES' && (
                    <>
                         <div className="grid grid-cols-2 gap-3 mb-4">
                             <button onClick={onScanInvoiceRequest} className="bg-brand-600 text-white p-3 rounded-lg flex items-center justify-center space-x-2">
                                 <Camera size={18} /> <span>Ler Boleto/Nota</span>
                             </button>
                             <button onClick={() => {
                                 const title = prompt("Descrição da conta:");
                                 const amount = parseFloat(prompt("Valor:") || "0");
                                 if (title && amount) {
                                     onAddDebt({
                                         id: Date.now().toString(),
                                         title, amount, 
                                         dueDate: new Date().toISOString(),
                                         isPaid: false, isRecurring: false
                                     });
                                 }
                             }} className="bg-white border border-gray-300 p-3 rounded-lg flex items-center justify-center">
                                 <Plus size={18} /> <span>Manual</span>
                             </button>
                         </div>

                        {debts.map(d => (
                            <div key={d.id} className={`bg-white p-4 rounded-lg shadow-sm border-l-4 flex justify-between items-center ${d.isPaid ? 'border-green-400 opacity-60' : 'border-red-400'}`}>
                                <div>
                                    <div className="font-bold">{d.title}</div>
                                    <div className="text-sm text-gray-500">Vence: {new Date(d.dueDate).toLocaleDateString()}</div>
                                    <div className="font-bold mt-1">R$ {d.amount.toFixed(2)}</div>
                                </div>
                                {!d.isPaid ? (
                                    <button 
                                        onClick={() => {
                                            // Mocking upload proof or just mark as paid
                                            if(confirm("Marcar como pago?")) onPayDebt(d.id);
                                        }}
                                        className="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg font-medium text-sm"
                                    >
                                        Pagar
                                    </button>
                                ) : <div className="text-green-600 flex items-center"><Check size={16} /> Pago</div>}
                            </div>
                        ))}
                    </>
                )}
            </div>
        </div>
    );
};

const InventoryView: React.FC<{ products: Product[], onUpdateProduct: (p: Product) => void, onScanInvoiceRequest: () => void, onDownloadTags: () => void }> = ({ products, onUpdateProduct, onScanInvoiceRequest, onDownloadTags }) => {
    return (
        <div className="flex flex-col h-full bg-gray-50">
            <div className="p-4 bg-white shadow-sm flex space-x-2 overflow-x-auto">
                <button onClick={onScanInvoiceRequest} className="bg-brand-50 text-brand-700 px-4 py-2 rounded-full whitespace-nowrap flex items-center space-x-2 border border-brand-200">
                    <Camera size={16} />
                    <span>Importar Nota (IA)</span>
                </button>
                <button onClick={onDownloadTags} className="bg-brand-50 text-brand-700 px-4 py-2 rounded-full whitespace-nowrap flex items-center space-x-2 border border-brand-200">
                    <Download size={16} />
                    <span>Baixar Etiquetas</span>
                </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {products.map(p => (
                    <div key={p.id} className="bg-white p-4 rounded-lg shadow-sm">
                        <div className="flex justify-between items-start mb-2">
                            <div>
                                <h3 className="font-bold text-gray-900">{p.name}</h3>
                                <p className="text-xs text-gray-500">{p.barcode || 'Sem código'}</p>
                            </div>
                            <div className="text-right">
                                <div className="text-sm text-gray-500">Estoque</div>
                                <div className={`font-bold ${p.stock < 5 ? 'text-red-500' : 'text-gray-800'}`}>{p.stock} {p.unit}</div>
                            </div>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-4 mt-3 pt-3 border-t border-gray-100">
                            <div>
                                <label className="text-xs text-gray-400">Custo</label>
                                <div className="font-medium text-gray-600">R$ {p.cost.toFixed(2)}</div>
                            </div>
                            <div>
                                <label className="text-xs text-gray-400">Venda</label>
                                <div 
                                    className="font-bold text-brand-600 flex items-center cursor-pointer"
                                    onClick={() => {
                                        const newPrice = prompt("Novo preço de venda:", p.price.toString());
                                        if (newPrice) onUpdateProduct({...p, price: parseFloat(newPrice)});
                                    }}
                                >
                                    R$ {p.price.toFixed(2)} <Settings size={12} className="ml-1 opacity-50" />
                                </div>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

const ReportsView: React.FC<{ sales: Sale[] }> = ({ sales }) => {
    // Simple logic to aggregate sales by day
    const chartData = useMemo(() => {
        const data: {[key:string]: number} = {};
        sales.forEach(s => {
            const date = s.date.split('T')[0]; // YYYY-MM-DD
            data[date] = (data[date] || 0) + s.total;
        });
        return Object.keys(data).slice(-7).map(date => ({ // Last 7 days
            name: date.split('-').slice(1).join('/'),
            vendas: data[date]
        }));
    }, [sales]);

    const totalSales = sales.reduce((acc, s) => acc + s.total, 0);

    return (
        <div className="flex flex-col h-full bg-white p-4 overflow-y-auto">
             <div className="mb-6">
                 <h2 className="text-gray-500 text-sm">Total Vendido (Geral)</h2>
                 <p className="text-3xl font-bold text-brand-600">R$ {totalSales.toFixed(2)}</p>
             </div>

             <div className="h-64 w-full mb-8">
                <h3 className="font-bold mb-4">Vendas (Últimos 7 dias)</h3>
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="name" axisLine={false} tickLine={false} />
                        <YAxis axisLine={false} tickLine={false} />
                        <Tooltip />
                        <Bar dataKey="vendas" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
                    </BarChart>
                </ResponsiveContainer>
             </div>

             <div>
                 <h3 className="font-bold mb-4">Últimas Vendas</h3>
                 <div className="space-y-2">
                     {sales.slice().reverse().slice(0, 5).map(s => (
                         <div key={s.id} className="flex justify-between p-3 bg-gray-50 rounded-lg">
                             <div>
                                 <div className="font-medium text-sm">{new Date(s.date).toLocaleString()}</div>
                                 <div className="text-xs text-gray-500">{s.clientName} - {s.paymentMethod}</div>
                             </div>
                             <div className="font-bold">R$ {s.total.toFixed(2)}</div>
                         </div>
                     ))}
                 </div>
             </div>
        </div>
    );
};

export default App;
