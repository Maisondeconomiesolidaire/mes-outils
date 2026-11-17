import { SectionHeader } from "../components/SectionHeader";
import { Navettes } from "../components/navettes/Navettes";

export function NavettesPage() {
  return (
    <div className="space-y-6">
      <SectionHeader title="Navettes" subtitle="Vos trajets en véhicule et les objets que la logistique vous propose d'emporter." />
      <Navettes />
    </div>
  );
}
