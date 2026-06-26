import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "./components/AppLayout";
import { RequirePermission } from "./components/RequirePermission";
import { Admin } from "./pages/Admin";
import { Actualites } from "./pages/Actualites";
import { Compte } from "./pages/Compte";
import { Gotravaux } from "./pages/Gotravaux";
import { Messagerie } from "./pages/Messagerie";
import { Portail } from "./pages/Portail";
import { Reservations } from "./pages/Reservations";
import { Salles } from "./pages/Salles";

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Portail />} />
        <Route path="/compte" element={<Compte />} />
        <Route
          path="/actualites"
          element={
            <RequirePermission pageKey="mesoutils:actualites">
              <Actualites />
            </RequirePermission>
          }
        />
        <Route
          path="/reservations"
          element={
            <RequirePermission pageKey="mesoutils:reservations">
              <Reservations />
            </RequirePermission>
          }
        />
        <Route
          path="/gotravaux"
          element={
            <RequirePermission pageKey="mesoutils:gotravaux">
              <Gotravaux />
            </RequirePermission>
          }
        />
        <Route
          path="/salles"
          element={
            <RequirePermission pageKey="mesoutils:salles">
              <Salles />
            </RequirePermission>
          }
        />
        <Route
          path="/messagerie"
          element={
            <RequirePermission>
              <Messagerie />
            </RequirePermission>
          }
        />
        <Route
          path="/admin"
          element={
            <RequirePermission adminOnly>
              <Admin />
            </RequirePermission>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
