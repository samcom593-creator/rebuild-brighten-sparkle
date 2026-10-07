import { Link } from "react-router-dom";
import { CalendarClock, ExternalLink, Pencil, UserX, Video, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { type CalendarItem, reminderStateLabel } from "@/lib/calendarAgenda";
import { BUSINESS_TZ, describeEventTime, formatDay, viewerTimeZone } from "@/lib/calendarTime";

export type AgendaActions = {
  onReschedule: (item: CalendarItem) => void;
  onCancel: (item: CalendarItem) => void;
  onNoShow: (item: CalendarItem) => void;
  onEditAppointment: (item: CalendarItem) => void;
  onCancelAppointment: (item: CalendarItem) => void;
};

const STATUS_CLASS: Record<string, string> = {
  scheduled: "border-border text-foreground",
  rescheduled: "border-primary/40 text-primary",
  canceled: "border-border text-muted-foreground line-through",
  completed: "border-success/40 text-success",
  no_show: "border-destructive/40 text-destructive",
};

const REMINDER_TONE: Record<string, string> = {
  ok: "text-success",
  warn: "text-warning",
  bad: "text-destructive",
  muted: "text-muted-foreground",
};

function personHref(item: CalendarItem): string | null {
  if (item.agenda?.application_id) return `/dashboard/recruiting?lead=${item.agenda.application_id}`;
  if (item.agenda?.agent_id) return `/dashboard/agents/${item.agenda.agent_id}`;
  return null;
}

function ownerText(item: CalendarItem, viewerUserId: string | null, ownerNames: Record<string, string>): string | null {
  const a = item.agenda;
  if (!a) return null;
  if (a.booking_source === "calendly" && !a.owner_user_id) return "Calendly host";
  if (!a.owner_user_id) return "Unassigned";
  if (a.owner_user_id === viewerUserId) return "You";
  return ownerNames[a.owner_user_id] ?? "Another staff member";
}

function KindLabel({ kind }: { kind: string }) {
  const label = kind === "onboarding_call" ? "Onboarding" : kind.replace(/_/g, " ");
  return <Badge variant="outline" className="shrink-0 text-[11px] capitalize">{label}</Badge>;
}

/**
 * Dense, scan-first agenda: one row per event, time in the event's own zone
 * with the viewer's local time beside it, and only the actions the record
 * actually supports.
 */
export function AgendaList({
  days,
  itemsByDay,
  todayKey,
  viewerUserId,
  ownerNames,
  actions,
  emptyText,
}: {
  days: string[];
  itemsByDay: Map<string, CalendarItem[]>;
  todayKey: string;
  viewerUserId: string | null;
  ownerNames: Record<string, string>;
  actions: AgendaActions;
  emptyText: string;
}) {
  const viewerTz = viewerTimeZone();
  const populated = days.filter((d) => (itemsByDay.get(d)?.length ?? 0) > 0);
  if (populated.length === 0) {
    return <p className="py-12 text-center text-sm text-muted-foreground">{emptyText}</p>;
  }
  const now = Date.now();

  return (
    <div className="divide-y divide-border">
      {populated.map((day) => (
        <section key={day} aria-label={formatDay(`${day}T19:00:00Z`, BUSINESS_TZ)}>
          <h3 className={cn(
            "sticky top-0 z-[1] bg-muted/60 px-3 py-1.5 text-xs font-semibold text-muted-foreground backdrop-blur",
            day === todayKey && "text-primary",
          )}>
            {formatDay(`${day}T19:00:00Z`, BUSINESS_TZ)}{day === todayKey ? " · Today" : ""}
          </h3>
          <ul className="divide-y divide-border/60">
            {(itemsByDay.get(day) ?? []).map((item) => {
              const t = item.allDay ? null : describeEventTime(item.startsAt, item.eventTz, viewerTz);
              const reminder = item.agenda ? reminderStateLabel(item.agenda.reminder_state) : null;
              const href = personHref(item);
              const owner = ownerText(item, viewerUserId, ownerNames);
              const open = item.status === "scheduled" || item.status === "rescheduled";
              const past = Date.parse(item.startsAt) < now;
              return (
                <li key={item.key} className="grid grid-cols-1 gap-2 px-3 py-2.5 sm:grid-cols-[150px_minmax(0,1fr)_auto] sm:items-center">
                  <div className="text-xs tabular-nums">
                    {t ? (
                      <>
                        <span className="font-medium text-foreground">{t.eventLabel}</span>
                        {t.zoneUnknown && item.agenda?.source_table === "interview_events" && (
                          <span className="block text-[11px] text-muted-foreground">zone not recorded</span>
                        )}
                        {t.viewerLabel && (
                          <span className="block text-[12px] text-muted-foreground">
                            {t.viewerLabel} your time{t.viewerDay ? ` · ${t.viewerDay}` : ""}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-muted-foreground">All day</span>
                    )}
                  </div>

                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <KindLabel kind={item.kind} />
                      {href ? (
                        <Link to={href} className="truncate text-sm font-medium text-foreground hover:underline">{item.title}</Link>
                      ) : (
                        <span className="truncate text-sm font-medium text-foreground">{item.title}</span>
                      )}
                      {item.status && STATUS_CLASS[item.status] && (
                        <Badge variant="outline" className={cn("text-[11px] capitalize", STATUS_CLASS[item.status])}>
                          {item.status.replace(/_/g, " ")}
                        </Badge>
                      )}
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-muted-foreground">
                      {item.subtitle && <span className="capitalize">{item.subtitle}</span>}
                      {owner && <span>Owner: {owner}</span>}
                      {reminder && <span className={REMINDER_TONE[reminder.tone]}>{reminder.label}</span>}
                      {item.agenda?.cancel_reason && item.status === "canceled" && <span>Reason: {item.agenda.cancel_reason}</span>}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1 sm:justify-end">
                    {item.link && open && (
                      <Button asChild variant="outline" size="sm" className="h-7 px-2 text-xs">
                        <a href={item.link} target="_blank" rel="noopener noreferrer" aria-label={`Join meeting with ${item.title}`}>
                          <Video className="mr-1 h-3.5 w-3.5" />Join
                        </a>
                      </Button>
                    )}
                    {item.editMode === "interview" && open && (
                      <>
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => actions.onReschedule(item)}>
                          <CalendarClock className="mr-1 h-3.5 w-3.5" />Reschedule
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-destructive" onClick={() => actions.onCancel(item)}>
                          <XCircle className="mr-1 h-3.5 w-3.5" />Cancel
                        </Button>
                      </>
                    )}
                    {item.editMode === "calendly" && open && !past && (
                      <>
                        {item.agenda?.reschedule_url && (
                          <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-xs">
                            <a href={item.agenda.reschedule_url} target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="mr-1 h-3.5 w-3.5" />Reschedule in Calendly
                            </a>
                          </Button>
                        )}
                        {item.agenda?.cancel_url && (
                          <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-xs text-destructive">
                            <a href={item.agenda.cancel_url} target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="mr-1 h-3.5 w-3.5" />Cancel in Calendly
                            </a>
                          </Button>
                        )}
                      </>
                    )}
                    {(item.editMode === "interview" || item.editMode === "calendly") && open && past && (
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-destructive" onClick={() => actions.onNoShow(item)}>
                        <UserX className="mr-1 h-3.5 w-3.5" />No-show
                      </Button>
                    )}
                    {item.editMode === "appointment" && item.status !== "canceled" && (
                      <>
                        <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Edit ${item.title}`} onClick={() => actions.onEditAppointment(item)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-destructive" onClick={() => actions.onCancelAppointment(item)}>
                          Cancel
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
