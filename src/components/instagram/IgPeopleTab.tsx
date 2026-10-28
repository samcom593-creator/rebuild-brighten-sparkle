// The people tab: find one person fast. The 60 recent threads, same row shape, filtered client-side
// on handle / name / last words. Handled and snoozed people stay reachable here with the word and time.
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { IgRow, type IgRowActionExtra, type IgRowActionKind } from "./IgRow";
import { EMPTY } from "./igCopy";
import type { IgRow as IgRowData } from "./igTypes";

export interface IgPeopleTabProps {
  people: IgRowData[];
  humanAgentSupported: boolean;
  onAction: (kind: IgRowActionKind, row: IgRowData, extra?: IgRowActionExtra) => void;
  now: number;
}

export function filterPeople(people: IgRowData[], q: string): IgRowData[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return people;
  return people.filter((p) =>
    [p.handle, p.name, p.last_body, p.phone, p.email].some((v) => (v ?? "").toLowerCase().includes(needle)),
  );
}

export function IgPeopleTab({ people, humanAgentSupported, onAction, now }: IgPeopleTabProps) {
  const [q, setQ] = useState("");
  const rows = useMemo(() => filterPeople(people, q), [people, q]);
  return (
    <div className="space-y-3">
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="handle, name, or what they said"
        aria-label="find a person"
        className="h-11 text-base sm:h-9 sm:text-sm"
      />
      {rows.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">{people.length === 0 ? EMPTY.noOneIn : EMPTY.nobodyHere}</p>
      ) : (
        <div>
          {rows.map((row) => (
            <IgRow key={row.external_id} row={row} context="people" humanAgentSupported={humanAgentSupported} onAction={onAction} now={now} />
          ))}
        </div>
      )}
    </div>
  );
}
