import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { useAuth } from "./lib/auth";
import { LoginPage, ResetPage, SetupPage } from "./pages/Auth";
import { CatPage } from "./pages/Cat";
import { CustomerDetail, CustomersPage } from "./pages/Customers";
import { DashboardPage } from "./pages/Dashboard";
import { HistoryPage } from "./pages/History";
import { IamPage } from "./pages/Iam";
import { IntegrationsPage } from "./pages/Integrations";
import { InventoryPage } from "./pages/Inventory";
import { OemPage } from "./pages/Oem";
import { OrderDetail, OrdersPage } from "./pages/Orders";
import { QuoteEditor, QuotesPage } from "./pages/Quotes";
import { SearchPage } from "./pages/Search";
import { SettingsPage } from "./pages/Settings";
import { StatsPage } from "./pages/Stats";
import { SupplierDetail, SuppliersPage } from "./pages/Suppliers";
import { VehicleDetail, VehiclesPage } from "./pages/Vehicles";

export function App() {
  const { user, loading, needsSetup } = useAuth();
  if (loading) return <div className="auth-page"><span className="spinner" /></div>;
  if (!user) {
    return (
      <Routes>
        <Route path="/restablecer" element={<ResetPage />} />
        <Route path="*" element={needsSetup ? <SetupPage /> : <LoginPage />} />
      </Routes>
    );
  }
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="buscador" element={<SearchPage />} />
        <Route path="vehiculos" element={<VehiclesPage />} />
        <Route path="vehiculos/:id" element={<VehicleDetail />} />
        <Route path="inventario" element={<InventoryPage />} />
        <Route path="oem" element={<OemPage />} />
        <Route path="iam" element={<IamPage />} />
        <Route path="cat" element={<CatPage />} />
        <Route path="clientes" element={<CustomersPage />} />
        <Route path="clientes/:id" element={<CustomerDetail />} />
        <Route path="proveedores" element={<SuppliersPage />} />
        <Route path="proveedores/:id" element={<SupplierDetail />} />
        <Route path="presupuestos" element={<QuotesPage />} />
        <Route path="presupuestos/:id" element={<QuoteEditor />} />
        <Route path="pedidos" element={<OrdersPage />} />
        <Route path="pedidos/:id" element={<OrderDetail />} />
        <Route path="historial" element={<HistoryPage />} />
        <Route path="estadisticas" element={<StatsPage />} />
        <Route path="integraciones" element={<IntegrationsPage />} />
        <Route path="configuracion" element={<SettingsPage />} />
        <Route path="restablecer" element={<Navigate to="/" />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Route>
    </Routes>
  );
}
