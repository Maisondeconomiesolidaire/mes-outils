import { useAction } from "convex/react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { MapPinned, Route, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

const MAPBOX_PUBLIC_TOKEN = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;

type MappedEmployee = {
  _id: Id<"hrEmployees">;
  fullName: string;
  address: string;
  structure: string;
  commuteDistanceKm?: number;
  commuteDurationMinutes?: number;
  commuteLongitude?: number;
  commuteLatitude?: number;
};

type CommuteRoute = {
  distanceKm: number;
  durationMinutes: number;
  workplaceAddress: string;
  coordinates: number[][];
};

function pinColorForStructure(structure: string) {
  const normalized = structure.toLocaleLowerCase("fr");
  if (normalized.includes("recyclerie") || normalized.includes("sens du bray")) return "#f97316";
  if (normalized.includes("pays de bray emploi")) return "#2563eb";
  if (normalized.includes("pays de bray services")) return "#64748b";
  return "#22c55e";
}

function createPin(structure: string) {
  const pin = document.createElement("button");
  pin.type = "button";
  pin.setAttribute("aria-label", "Voir les informations du salarié");
  const color = pinColorForStructure(structure);
  pin.dataset.baseColor = color;
  pin.style.cssText = `width:29px;height:29px;border:3px solid white;border-radius:999px;background:${color};box-shadow:0 4px 12px rgba(15,23,42,.38);cursor:pointer;`;
  return pin;
}

/** Carte interne : les coordonnées proviennent du géocodage sauvegardé côté RH. */
export function EmployeeMap({ employees }: { employees: MappedEmployee[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const selectedIdRef = useRef<Id<"hrEmployees"> | null>(null);
  const getCommuteRoute = useAction(api.rh.getDashboardCommuteRoute);
  const [selected, setSelected] = useState<{ employee: MappedEmployee; route?: CommuteRoute; error?: string; loading: boolean } | null>(null);
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
    const drawRoute = (route: CommuteRoute) => {
      const routeData = {
        type: "Feature" as const,
        properties: {},
        geometry: { type: "LineString" as const, coordinates: route.coordinates },
      };
      const source = map.getSource("employee-commute-route") as mapboxgl.GeoJSONSource | undefined;
      if (source) {
        source.setData(routeData);
      } else {
        map.addSource("employee-commute-route", { type: "geojson", data: routeData });
        map.addLayer({
          id: "employee-commute-route-line",
          type: "line",
          source: "employee-commute-route",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#2563eb", "line-width": 5, "line-opacity": 0.9 },
        });
      }
      const bounds = new mapboxgl.LngLatBounds();
      route.coordinates.forEach((coordinate) => bounds.extend([coordinate[0], coordinate[1]]));
      map.fitBounds(bounds, { padding: 64, maxZoom: 14, duration: 750 });
    };
    const clearRoute = () => {
      if (map.getLayer("employee-commute-route-line")) map.removeLayer("employee-commute-route-line");
      if (map.getSource("employee-commute-route")) map.removeSource("employee-commute-route");
    };

    let activePin: HTMLButtonElement | null = null;
    const markers = points.map((employee) => {
      const pin = createPin(employee.structure);
      const marker = new mapboxgl.Marker({ element: pin, anchor: "bottom" })
        .setLngLat([employee.commuteLongitude, employee.commuteLatitude])
        .addTo(map);
      pin.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (activePin && activePin !== pin) activePin.style.background = activePin.dataset.baseColor ?? "#22c55e";
        pin.style.background = "#2563eb";
        activePin = pin;
        clearRoute();
        selectedIdRef.current = employee._id;
        setSelected({ employee, loading: true });
        void getCommuteRoute({ employeeId: employee._id })
          .then((route) => {
            if (selectedIdRef.current !== employee._id) return;
            drawRoute(route as CommuteRoute);
            setSelected({ employee, route: route as CommuteRoute, loading: false });
          })
          .catch((error) => {
            if (selectedIdRef.current !== employee._id) return;
            const message = error instanceof Error ? error.message : "Itinéraire impossible.";
            setSelected({ employee, error: message, loading: false });
          });
      });
      return marker;
    });
    map.on("load", () => {
      const bounds = new mapboxgl.LngLatBounds();
      points.forEach((employee) => bounds.extend([employee.commuteLongitude, employee.commuteLatitude]));
      if (points.length > 1) map.fitBounds(bounds, { padding: 56, maxZoom: 12 });
    });
    return () => {
      markers.forEach((marker) => marker.remove());
      selectedIdRef.current = null;
      map.remove();
    };
  }, [getCommuteRoute, points]);

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
      <div className="flex flex-wrap gap-x-4 gap-y-2 border-t border-[var(--border)] px-5 py-2.5 text-xs font-semibold text-[var(--muted-foreground)]">
        <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-orange-500" />Recycleries &amp; LSDB</span>
        <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-blue-600" />PBE</span>
        <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-slate-500" />PBS</span>
      </div>
      {points.length > 0 ? (
        <div className="relative h-[420px] w-full overflow-hidden">
          <div ref={containerRef} className="h-full w-full" aria-label="Carte des adresses des salariés" />
          {selected ? (
            <aside key={selected.employee._id} className="employee-map-panel absolute bottom-3 right-3 top-3 z-10 flex w-[min(22rem,calc(100%-1.5rem))] flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
              <button type="button" className="absolute right-3 top-3 rounded-full p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--accent)]" aria-label="Fermer la fiche du salarié" onClick={() => { selectedIdRef.current = null; setSelected(null); }}><X className="h-4 w-4" /></button>
              <p className="pr-8 text-lg font-extrabold text-[var(--foreground)]">{selected.employee.fullName}</p>
              <p className="mt-1 text-sm font-bold text-emerald-700 dark:text-emerald-400">{selected.employee.structure}</p>
              <p className="mt-4 text-sm leading-6 text-[var(--muted-foreground)]">{selected.employee.address}</p>
              <div className="mt-5 rounded-xl bg-emerald-50 p-3 text-sm dark:bg-emerald-500/10">
                <div className="flex items-center gap-2 font-extrabold text-emerald-800 dark:text-emerald-300"><Route className="h-4 w-4" />Itinéraire domicile → travail</div>
                {selected.loading ? <p className="mt-2 text-emerald-700 dark:text-emerald-300">Calcul de l’itinéraire…</p> : null}
                {selected.route ? <><p className="mt-2 text-base font-extrabold text-emerald-800 dark:text-emerald-200">{selected.route.distanceKm.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} km · {selected.route.durationMinutes} min</p><p className="mt-2 text-xs leading-5 text-emerald-800/80 dark:text-emerald-200/80">Destination : {selected.route.workplaceAddress}</p></> : null}
                {selected.error ? <p className="mt-2 text-red-700 dark:text-red-300">{selected.error}</p> : null}
              </div>
            </aside>
          ) : null}
        </div>
      ) : (
        <p className="border-t border-[var(--border)] px-5 py-8 text-center text-sm text-[var(--muted-foreground)]">Les adresses seront positionnées après le prochain calcul des distances.</p>
      )}
    </section>
  );
}
