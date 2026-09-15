import { Dialog } from "radix-ui";
import { CirclePlay } from "lucide-react";
import { Button } from "../ui/Button";

type Kind = "rooms" | "vehicles" | "equipment";

/** Tutoriels Supademo, par type de ressource. Les équipements n'en ont pas. */
const TUTORIALS: Partial<Record<Kind, { id: string; title: string }>> = {
  rooms: { id: "cmtwx2ybg1sceqm7x2fvv213r", title: "Réservation de salles MESOUTILS" },
  vehicles: { id: "cmtwy2kpe1v2jqm7xm504th6s", title: "Comment réserver un véhicule sur MESOUTILS" },
};

const WHAT: Record<Kind, string> = {
  rooms: "Les salles libres sur ce créneau s'afficheront ensuite.",
  vehicles: "Les véhicules libres sur ce créneau s'afficheront ensuite.",
  equipment: "Les équipements libres sur ce créneau s'afficheront ensuite.",
};

/**
 * En-tête de l'écran de réservation : l'invitation à choisir une date, puis le
 * tutoriel vidéo. Tant qu'aucune recherche n'est lancée, la page n'affiche que
 * ça et la barre de recherche — les disponibilités n'ont pas de sens sans
 * créneau.
 */
export function ReservationIntro({ kind, showHint }: { kind: Kind; showHint: boolean }) {
  const tutorial = TUTORIALS[kind];
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      {showHint ? (
        <div>
          <h2 className="text-xl font-bold text-[var(--foreground)] sm:text-2xl">
            Commencez par choisir votre date
          </h2>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">{WHAT[kind]}</p>
        </div>
      ) : null}
      {tutorial ? (
        <Dialog.Root>
          <Dialog.Trigger asChild>
            <Button type="button" variant="secondary">
              <CirclePlay className="h-4 w-4" aria-hidden="true" />
              Comment réserver
            </Button>
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45" />
            <Dialog.Content
              aria-describedby={undefined}
              className="fixed left-1/2 top-1/2 z-50 aspect-[1.8] w-[min(90vw,144svh)] max-w-6xl -translate-x-1/2 -translate-y-1/2 outline-none"
            >
              <Dialog.Title className="sr-only">Tutoriel de réservation</Dialog.Title>
              <Dialog.Close asChild>
                <Button type="button" variant="secondary" size="sm" className="absolute bottom-full right-0 mb-2">
                  Fermer
                </Button>
              </Dialog.Close>
              <iframe
                src={`https://app.supademo.com/embed/${tutorial.id}?embed_v=2&utm_source=embed`}
                loading="lazy"
                title={tutorial.title}
                allow="clipboard-write"
                allowFullScreen
                className="absolute inset-0 block h-full w-full border-0"
              />
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      ) : null}
    </div>
  );
}
