import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { MapPinned } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";

const MAPBOX_PUBLIC_TOKEN = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;

type MappedEmployee = {
  _id: string;
  fullName: string;
  address: string;
  structure: string;
  commuteDistanceKm?: number;
  commuteDurationMinutes?: number;
  commuteLongitude?: number;
  commuteLatitude?: number;
};

function createPopup(employee: MappedEmployee) {
  const content = document.createElement("div");
  content.style.cssText = "min-width:190px;padding:2px 1px;font-family:Inter,system-ui,sans-serif;";
  const name = document.createElement("p");
  name.textContent = employee.fullName;
  name.style.cssText = "margin:0;font-size:14px;font-weight:800;color:#18181b;";
  const structure = document.createElement("p");
  structure.textContent = employee.structure;
  structure.style.cssText = "margin:3px 0 0;font-size:12px;font-weight:700;color:#15803d;";
  const address = document.createElement("p");
  address.textContent = employee.address;
  address.style.cssText = "margin:7px 0 0;font-size:12px;line-height:1.4;color:#52525b;";
  content.append(name, structure, address);
  if (employee.commuteDistanceKm !== undefined) {
    const distance = document.createElement("p");
    const duration = employee.commuteDurationMinutes !== undefined ? ` · ${employee.commuteDurationMinutes} min` : "";
    distance.textContent = `Distance domicile → travail : ${employee.commuteDistanceKm.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} km${duration}`;
    distance.style.cssText = "margin:8px 0 0;font-size:12px;font-weight:700;color:#166534;";
    content.append(distance);
  }
  return content;
}

function createPin() {
  const pin = document.createElement("button");
  pin.type = "button";
  pin.setAttribute("aria-label", "Voir les informations du salarié");
  pin.style.cssText = "width:29px;height:29px;border:3px solid white;border-radius:999px;background:#22c55e;box-shadow:0 4px 12px rgba(22,101,52,.45);cursor:pointer;";
  return pin;
}

/** Carte interne : les coordonnées proviennent du géocodage sauvegardé côté RH. */
export function EmployeeMap({ employees }: { employees: MappedEmployee[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const points = useMemo(
    () => employees.filter((employee): employee is MappedEmployee & { commuteLongitude: number; commuteLatitude: number } =>
      typeof employee.commuteLongitude === "number" && typeof employee.commuteLatitude === "number"),
    [employees],
  );

  useEffect(() => {
    if (!MAPBOX_PUBLIC_TOKEN || !containerRef.current || points.length === 0) return;
    mapboxgl.accessToken = MAPBOX_PUBLIC_TOKEN;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/standard",
      center: [points[0].commuteLongitude, points[0].commuteLatitude],
      zoom: 10,
    });
    const markers = points.map((employee) =>
      new mapboxgl.Marker({ element: createPin(), anchor: "bottom" })
        .setLngLat([employee.commuteLongitude, employee.commuteLatitude])
        .setPopup(new mapboxgl.Popup({ offset: 18, closeButton: true }).setDOMContent(createPopup(employee)))
        .addTo(map),
    );
    map.on("load", () => {
      const bounds = new mapboxgl.LngLatBounds();
      points.forEach((employee) => bounds.extend([employee.commuteLongitude, employee.commuteLatitude]));
      if (points.length > 1) map.fitBounds(bounds, { padding: 56, maxZoom: 12 });
    });
    return () => {
      markers.forEach((marker) => marker.remove());
      map.remove();
    };
  }, [points]);

  if (!MAPBOX_PUBLIC_TOKEN) {
    return <p className="rounded-xl border border-[var(--border)] bg-[var(--accent)] px-4 py-3 text-sm text-[var(--muted-foreground)]">Carte indisponible : le token cartographique n&apos;est pas configuré.</p>;
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm">
      <div className="flex items-center justify-between gap-3 px-5 py-4">
        <div className="flex items-center gap-2">
          <MapPinned className="h-5 w-5 text-brand-600" />
          <h2 className="text-lg font-extrabold tracking-tight text-[var(--foreground)]">Carte des salariés</h2>
        </div>
        <span className="text-sm text-[var(--muted-foreground)]">{points.length} adresse{points.length > 1 ? "s" : ""} positionnée{points.length > 1 ? "s" : ""}</span>
      </div>
      {points.length > 0 ? (
        <div ref={containerRef} className="h-[420px] w-full" aria-label="Carte des adresses des salariés" />
      ) : (
        <p className="border-t border-[var(--border)] px-5 py-8 text-center text-sm text-[var(--muted-foreground)]">Les adresses seront positionnées après le prochain calcul des distances.</p>
      )}
    </section>
  );
}
