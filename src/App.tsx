import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "./components/AppLayout";
import { RequirePermission } from "./components/RequirePermission";
import { Admin } from "./pages/Admin";
import { Actualites } from "./pages/Actualites";
import { Compte } from "./pages/Compte";
import { Gotravaux } from "./pages/Gotravaux";
import { Messagerie } from "./pages/Messagerie";
import { Notifications } from "./pages/Notifications";
import { Portail } from "./pages/Portail";
import { Conges } from "./pages/Conges";
import { Reservations } from "./pages/Reservations";
import { RessourcesHumaines } from "./pages/RessourcesHumaines";
import { Salles } from "./pages/Salles";
import { ConfirmRoot } from "./lib/confirm";
import { UpdateAvailableBanner } from "./components/UpdateAvailableBanner";

export default function App() {
  return (
    <>
    <UpdateAvailableBanner appName="Mes Outils" />
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/sign-in/*" element={<Portail />} />
        <Route path="/sign-up/*" element={<Portail />} />
        <Route index element={<Portail />} />
        <Route path="/portail" element={<Portail />} />
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
          path="/conges"
          element={
            <RequirePermission pageKey="mesoutils:conges">
              <Conges />
            </RequirePermission>
          }
        />
        <Route
          path="/rh"
          element={
            <RequirePermission pageKey="mesoutils:rh">
              <RessourcesHumaines />
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
          path="/notifications"
          element={
            <RequirePermission>
              <Notifications />
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
    <ConfirmRoot />
    </>
  );
}
