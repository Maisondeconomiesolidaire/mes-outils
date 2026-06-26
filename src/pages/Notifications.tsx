import { useMutation, useQuery } from "convex/react";
import { Bell, CalendarCheck, CarFront, MessageCircle, ThumbsUp } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { SectionHeader } from "../components/SectionHeader";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { FullSpinner } from "../components/ui/Spinner";
import { formatRelative } from "../lib/format";

type NotificationItem = {
  _id: Id<"mesoutilsNotifications">;
  kind: "room_reservation_confirmed" | "vehicle_reservation_decided" | "new_direct_message" | "post_liked" | "post_commented";
  title: string;
  body?: string;
  actorName?: string;
  href?: string;
  read: boolean;
  createdAt: number;
};

export function Notifications() {
  const notifications = useQuery(api.mesoutilsNotifications.list) as NotificationItem[] | undefined;
  const markRead = useMutation(api.mesoutilsNotifications.markRead);
  const markAllRead = useMutation(api.mesoutilsNotifications.markAllRead);

  if (notifications === undefined) return <FullSpinner label="Chargement des notifications..." />;

  const unread = notifications.filter((notification) => !notification.read).length;

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Notifications"
        subtitle="Messages, réservations et activité de vos publications"
        actions={
          unread > 0 ? (
            <Button variant="secondary" onClick={() => markAllRead()}>
              Tout marquer comme lu
            </Button>
          ) : undefined
        }
      />

      {notifications.length === 0 ? (
        <EmptyState icon={<Bell className="h-8 w-8" />} title="Aucune notification" description="Les nouveautés importantes apparaîtront ici." />
      ) : (
        <section className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)]">
          <div className="divide-y divide-[var(--border)]">
            {notifications.map((notification) => (
              <NotificationRow key={notification._id} notification={notification} onRead={() => markRead({ notificationId: notification._id })} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function NotificationRow({ notification, onRead }: { notification: NotificationItem; onRead: () => void }) {
  const Icon = iconFor(notification.kind);
  const content = (
    <div className="flex gap-4 p-4 text-left transition hover:bg-[var(--accent)]">
      <span className={`mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${notification.read ? "bg-[var(--accent)] text-[var(--muted-foreground)]" : "bg-brand-500 text-white"}`}>
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold text-[var(--foreground)]">{notification.title}</p>
          {!notification.read ? <span className="h-2 w-2 rounded-full bg-brand-500" /> : null}
        </div>
        {notification.body ? <p className="mt-1 line-clamp-2 text-sm text-[var(--muted-foreground)]">{notification.body}</p> : null}
        <p className="mt-2 text-xs font-medium text-[var(--muted-foreground)]">{formatRelative(notification.createdAt)}</p>
      </div>
    </div>
  );

  if (notification.href) {
    return (
      <Link to={notification.href} onClick={onRead} className="block">
        {content}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onRead} className="block w-full">
      {content}
    </button>
  );
}

function iconFor(kind: NotificationItem["kind"]) {
  if (kind === "new_direct_message") return MessageCircle;
  if (kind === "post_liked") return ThumbsUp;
  if (kind === "post_commented") return MessageCircle;
  if (kind === "vehicle_reservation_decided") return CarFront;
  return CalendarCheck;
}
