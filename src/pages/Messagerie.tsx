import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useSearchParams } from "react-router-dom";
import { useUser } from "@clerk/clerk-react";
import { ArrowLeft, MessagesSquare, Send, Tag, X } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { Input } from "../components/ui/Field";
import { FullSpinner } from "../components/ui/Spinner";
import { formatRelative } from "../lib/format";
import { cn } from "../lib/cn";

type Conversation = {
  clerkId: string;
  name: string;
  imageUrl?: string;
  lastBody: string;
  lastAt: number;
  unread: number;
};

function useConversations() {
  return useQuery(api.community.listConversations) as Conversation[] | undefined;
}

/** Hook partagé : conversation active (depuis l'URL ?to=) + helper de sélection. */
function useActiveConversation(conversations: Conversation[] | undefined) {
  const [searchParams, setSearchParams] = useSearchParams();
  const to = searchParams.get("to");
  const name = searchParams.get("name");

  const activeId = to ?? conversations?.[0]?.clerkId ?? null;
  const activeName =
    name ??
    conversations?.find((conversation) => conversation.clerkId === activeId)?.name ??
    "Utilisateur";

  function select(conversation: { clerkId: string; name: string }) {
    const next = new URLSearchParams(searchParams);
    next.set("to", conversation.clerkId);
    next.set("name", conversation.name);
    setSearchParams(next, { replace: true });
  }

  function clear() {
    const next = new URLSearchParams(searchParams);
    next.delete("to");
    next.delete("name");
    setSearchParams(next, { replace: true });
  }

  return { activeId, activeName, select, clear };
}

function ConversationList({
  conversations,
  activeId,
  onSelect,
}: {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (conversation: Conversation) => void;
}) {
  if (conversations.length === 0) {
    return (
      <div className="p-4">
        <EmptyState
          icon={<MessagesSquare className="h-7 w-7" />}
          title="Aucune conversation"
          description="Envoyez votre premier message."
        />
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {conversations.map((conversation) => (
        <button
          key={conversation.clerkId}
          type="button"
          onClick={() => onSelect(conversation)}
          className={cn(
            "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition",
            activeId === conversation.clerkId
              ? "bg-brand-500 text-white"
              : "text-[var(--foreground)] hover:bg-[var(--accent)]",
          )}
        >
          <Avatar name={conversation.name} src={conversation.imageUrl} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{conversation.name}</span>
            <span
              className={cn(
                "block truncate text-xs",
                activeId === conversation.clerkId ? "text-white/75" : "text-[var(--muted-foreground)]",
              )}
            >
              {conversation.lastBody}
            </span>
          </span>
          {conversation.unread > 0 && activeId !== conversation.clerkId ? (
            <span className="rounded-full bg-brand-500 px-2 py-0.5 text-xs font-bold text-white">
              {conversation.unread}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

type DealContext = { title: string; image?: string; type?: string; price?: string };

export function Messagerie() {
  const { user } = useUser();
  const conversations = useConversations();
  const { activeId, activeName, select, clear } = useActiveConversation(conversations);
  const [searchParams] = useSearchParams();

  const prefill = searchParams.get("prefill") ?? undefined;
  const ctxTitle = searchParams.get("ctxTitle");
  const dealContext: DealContext | null = ctxTitle
    ? {
        title: ctxTitle,
        image: searchParams.get("ctxImage") ?? undefined,
        type: searchParams.get("ctxType") ?? undefined,
        price: searchParams.get("ctxPrice") ?? undefined,
      }
    : null;

  if (conversations === undefined) {
    return <FullSpinner label="Chargement de la messagerie..." />;
  }

  return (
    <div className="flex h-full min-h-0 overflow-hidden border-[var(--border)] bg-[var(--card)] lg:rounded-2xl lg:border">
      {/* Liste des conversations : colonne fixe en desktop, plein écran en
          mobile tant qu'aucune conversation n'est ouverte. */}
      <div
        className={cn(
          "flex min-h-0 w-full flex-col border-[var(--border)] lg:w-80 lg:border-r",
          activeId ? "hidden lg:flex" : "flex",
        )}
      >
        <div className="border-b border-[var(--border)] px-4 py-3">
          <h1 className="text-lg font-semibold text-[var(--foreground)]">Messagerie</h1>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <ConversationList conversations={conversations} activeId={activeId} onSelect={select} />
        </div>
      </div>

      {/* Chat. */}
      <div className={cn("min-h-0 flex-1 flex-col", activeId ? "flex" : "hidden lg:flex")}>
        {activeId ? (
          <Thread
            otherClerkId={activeId}
            otherName={activeName}
            meName={user?.fullName ?? "Moi"}
            meImage={user?.imageUrl}
            onBack={clear}
            prefill={prefill}
            dealContext={dealContext}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center p-10">
            <EmptyState
              icon={<MessagesSquare className="h-7 w-7" />}
              title="Sélectionnez une conversation"
              description="Choisissez un échange dans la barre latérale pour afficher les messages."
            />
          </div>
        )}
      </div>
    </div>
  );
}

function Thread({
  otherClerkId,
  otherName,
  meName,
  meImage,
  onBack,
  prefill,
  dealContext,
}: {
  otherClerkId: string;
  otherName: string;
  meName: string;
  meImage?: string;
  onBack: () => void;
  prefill?: string;
  dealContext?: DealContext | null;
}) {
  const messages = useQuery(api.community.listThread, { otherClerkId });
  const send = useMutation(api.community.sendMessage);
  const markRead = useMutation(api.community.markThreadRead);
  const [draft, setDraft] = useState("");
  const [context, setContext] = useState<DealContext | null>(dealContext ?? null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Pré-remplit le message (façon "leboncoin") une seule fois par conversation/annonce.
  useEffect(() => {
    if (prefill) setDraft(prefill);
    setContext(dealContext ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otherClerkId, prefill, dealContext?.title]);

  useEffect(() => {
    if (messages && messages.length > 0) {
      void markRead({ otherClerkId });
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, markRead, otherClerkId]);

  const grouped = useMemo(() => messages ?? [], [messages]);

  async function submit() {
    const body = draft.trim();
    if (!body) return;
    setDraft("");
    setContext(null);
    await send({ toClerkId: otherClerkId, toName: otherName, body });
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--card)]">
      <header className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3.5 sm:px-5">
        <button
          type="button"
          onClick={onBack}
          className="-ml-1 inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--muted-foreground)] hover:bg-[var(--accent)] lg:hidden"
          aria-label="Retour aux conversations"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <Avatar name={otherName} />
        <p className="font-semibold text-[var(--foreground)]">{otherName}</p>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto p-4 sm:p-5">
        {messages === undefined ? (
          <FullSpinner label="Chargement..." />
        ) : grouped.length === 0 ? (
          <p className="text-center text-sm text-[var(--muted-foreground)]">
            Démarrez la conversation avec {otherName}.
          </p>
        ) : (
          grouped.map((message) => (
            <div key={message._id} className={cn("flex", message.mine ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[78%] rounded-2xl px-4 py-2.5 text-sm leading-6",
                  message.mine ? "bg-brand-500 text-white" : "bg-[var(--accent)] text-[var(--foreground)]",
                )}
              >
                <p className="whitespace-pre-wrap">{message.body}</p>
                <p className={cn("mt-1 text-[11px]", message.mine ? "text-white/70" : "text-[var(--muted-foreground)]")}>
                  {formatRelative(message.createdAt)}
                </p>
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {context ? (
        <div className="flex items-center gap-3 border-t border-[var(--border)] bg-[var(--accent)] px-3 py-2.5">
          {context.image ? (
            <img src={context.image} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
          ) : (
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-[var(--card)]">
              <Tag className="h-5 w-5 text-[var(--muted-foreground)]" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-wide text-brand-600">
              {context.type ? `Bon plan · ${context.type}` : "Bon plan"}
            </p>
            <p className="truncate text-sm font-semibold text-[var(--foreground)]">{context.title}</p>
          </div>
          {context.price ? <span className="shrink-0 text-sm font-bold text-[var(--foreground)]">{context.price} €</span> : null}
          <button
            type="button"
            onClick={() => setContext(null)}
            className="shrink-0 rounded-full p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--card)]"
            aria-label="Retirer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      <div className="flex items-center gap-2 border-t border-[var(--border)] p-3">
        <Avatar name={meName} src={meImage} size="sm" />
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
          placeholder="Votre message..."
          className="rounded-full"
        />
        <Button onClick={submit} disabled={!draft.trim()}>
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </section>
  );
}

function Avatar({ name, src, size = "md" }: { name: string; src?: string; size?: "sm" | "md" }) {
  const classes = size === "sm" ? "h-9 w-9 text-xs" : "h-10 w-10 text-sm";
  return (
    <div className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-600 font-semibold text-white ${classes}`}>
      {src ? <img src={src} alt={name} className="h-full w-full object-cover" /> : name.slice(0, 2).toUpperCase()}
    </div>
  );
}
