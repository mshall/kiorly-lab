import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { CalendarPlus, MonitorPlay, PhoneCall, Ticket } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { dt, today } from "@/lib/format";
import { Badge, Button, Card, CardTitle, Field, Input, Modal, Select, Table, Tabs, Td, useToast } from "@/components/ui";
import { PriorityChip } from "@/components/kit";
import { EmptyState, StatCard, Surface } from "@/brand/ui-kit";
import { ErrorNote, PageHeader, StatusBadge } from "@/components/common";

/** M2 reception desk: queue / token management and appointments with slot capacity. */
export function ReceptionPage() {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState("queue");
  const [date, setDate] = useState(() => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10));
  const [counter, setCounter] = useState("1");
  const [tk, setTk] = useState({ patientName: "", priority: "ROUTINE" });
  const [book, setBook] = useState<any>(null);
  const board = useQuery({ queryKey: ["queue-board"], queryFn: () => api<any>("/queue/board"), refetchInterval: 8000 });
  const tickets = useQuery({ queryKey: ["queue-tickets"], queryFn: () => api<any[]>("/queue/tickets"), refetchInterval: 8000 });
  const appts = useQuery({ queryKey: ["appointments", date], queryFn: () => api<any[]>(`/appointments?date=${date}`), enabled: tab === "appts" });
  const avail = useQuery({ queryKey: ["avail", date], queryFn: () => api<any[]>(`/appointments/availability?date=${date}`), enabled: tab === "appts" });
  const refresh = () => void qc.invalidateQueries();
  const issue = useMutation({ mutationFn: () => api("/queue/tickets", { body: { priority: tk.priority, patientName: tk.patientName || undefined } }), onSuccess: () => { setTk({ ...tk, patientName: "" }); refresh(); } });
  const call = useMutation({ mutationFn: () => api("/queue/call-next", { body: { counter } }), onSuccess: refresh });
  const move = useMutation({ mutationFn: (v: { id: string; to: string }) => api(`/queue/tickets/${v.id}/${v.to}`, { body: {} }), onSuccess: refresh });
  const bookM = useMutation({ mutationFn: () => api("/appointments", { body: { patientName: book.patientName, phone: book.phone || undefined, startsAt: `${date}T${book.time}:00.000Z`, kind: book.kind, testCodes: book.tests ? book.tests.split(",").map((x: string) => x.trim().toUpperCase()).filter(Boolean) : [], fasting: book.fasting } }), onSuccess: () => { setBook(null); refresh(); toast(t("rec.booked")); } });
  const appt = useMutation({ mutationFn: (v: { id: string; act: string }) => api(`/appointments/${v.id}/${v.act}`, { body: {} }), onSuccess: refresh });
  const waiting = board.data?.waiting ?? [];
  return (
    <>
      <PageHeader title={t("rec.title")} sub={t("rec.sub")} actions={<Link to="/queue-board" target="_blank"><Button variant="outline" size="sm"><MonitorPlay aria-hidden className="size-4" />{t("rec.openBoard")}</Button></Link>} />
      <Tabs tabs={[{ id: "queue", label: t("rec.queue") }, { id: "appts", label: t("rec.appointments") }]} value={tab} onChange={setTab} />
      {tab === "queue" ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3"><StatCard label={t("rec.waiting")} value={String(board.data?.stats.waiting ?? 0)} tone={waiting.length > 5 ? "warn" : "neutral"} /><StatCard label={t("rec.served")} value={String(board.data?.stats.served ?? 0)} tone="good" /><StatCard label={t("rec.avgWait")} value={`${board.data?.stats.avgWaitMinutes ?? 0} ${t("crit.min")}`} /></div>
            <Table head={[t("rec.ticket"), t("orders.patient"), t("orders.priority"), t("rec.counter"), t("common.status"), ""]}>
              {(tickets.data ?? []).filter((x) => !["DONE", "CANCELLED"].includes(x.status)).map((x) => (
                <tr key={x.id}>
                  <Td><span className="font-mono text-base font-bold">{x.code}</span></Td><Td dir="auto">{x.patientName ?? "-"}</Td><Td><PriorityChip priority={x.priority} /></Td><Td>{x.counter ?? "-"}</Td><Td><StatusBadge value={x.status} /></Td>
                  <Td>{can("queue.manage") ? <div className="flex flex-wrap gap-1">
                    {x.status === "CALLED" ? <><Button size="sm" onClick={() => move.mutate({ id: x.id, to: "serve" })}>{t("rec.serve")}</Button><Button size="sm" variant="ghost" onClick={() => move.mutate({ id: x.id, to: "skip" })}>{t("rec.skip")}</Button></> : null}
                    {x.status === "SERVING" ? <Button size="sm" variant="outline" onClick={() => move.mutate({ id: x.id, to: "done" })}>{t("rec.done")}</Button> : null}
                    {x.status === "SKIPPED" ? <Button size="sm" variant="ghost" onClick={() => move.mutate({ id: x.id, to: "recall" })}>{t("rec.recall")}</Button> : null}
                    {x.status === "SERVING" ? <Link to="/orders/new"><Button size="sm" variant="ghost">{t("orders.new")}</Button></Link> : null}
                  </div> : null}</Td>
                </tr>
              ))}
            </Table>
            {!(tickets.data ?? []).some((x) => !["DONE", "CANCELLED"].includes(x.status)) ? <EmptyState compact title={t("rec.emptyQueue")} /> : null}
          </div>
          {can("queue.manage") ? (
            <div className="space-y-4">
              <Card className="space-y-3">
                <CardTitle><PhoneCall aria-hidden className="me-2 inline size-4" />{t("rec.callNext")}</CardTitle>
                <Field label={t("rec.counter")}><Input value={counter} onChange={(e) => setCounter(e.target.value)} /></Field>
                <ErrorNote error={call.error} />
                <Button className="w-full" size="lg" disabled={!counter || call.isPending} onClick={() => call.mutate()}>{t("rec.callNext")}</Button>
              </Card>
              <Card className="space-y-3">
                <CardTitle><Ticket aria-hidden className="me-2 inline size-4" />{t("rec.newTicket")}</CardTitle>
                <Field label={t("orders.patient")}><Input value={tk.patientName} onChange={(e) => setTk({ ...tk, patientName: e.target.value })} placeholder={t("rec.optional")} /></Field>
                <Field label={t("orders.priority")}><Select value={tk.priority} onChange={(e) => setTk({ ...tk, priority: e.target.value })}>{["ROUTINE", "URGENT", "STAT"].map((p) => <option key={p} value={p}>{t(`ux.priority.${p}`, { defaultValue: p })}</option>)}</Select></Field>
                <Button className="w-full" variant="outline" disabled={issue.isPending} onClick={() => issue.mutate()}>{t("rec.issue")}</Button>
              </Card>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <Field label={t("common.date")}><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            {can("appointments.manage") ? <Button onClick={() => setBook({ patientName: "", phone: "", time: "09:00", kind: "WALK_IN", tests: "", fasting: false })}><CalendarPlus aria-hidden className="size-4" />{t("rec.book")}</Button> : null}
          </div>
          <Surface className="p-3">
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6 lg:grid-cols-8">
              {(avail.data ?? []).map((s) => <button key={s.startsAt} type="button" disabled={!can("appointments.manage") || s.free === 0} onClick={() => setBook({ patientName: "", phone: "", time: new Date(s.startsAt).toISOString().slice(11, 16), kind: "WALK_IN", tests: "", fasting: false })} className={`rounded-lg border px-2 py-1.5 text-center text-xs ${s.free === 0 ? "border-border bg-muted text-muted-foreground" : "border-border hover:border-primary hover:bg-accent"}`}><div className="font-semibold tabular-nums">{new Date(s.startsAt).toISOString().slice(11, 16)}</div><div className="tabular-nums text-muted-foreground">{s.booked}/{s.capacity}</div></button>)}
            </div>
          </Surface>
          <Table head={[t("common.time"), t("orders.patient"), t("rec.kind"), t("orders.tests"), t("common.status"), ""]}>
            {(appts.data ?? []).map((a) => (
              <tr key={a.id}>
                <Td className="tabular-nums">{new Date(a.startsAt).toISOString().slice(11, 16)}</Td><Td dir="auto">{a.patientName}{a.fasting ? <Badge tone="warn" className="ms-2">{t("rec.fasting")}</Badge> : null}</Td><Td>{t(`rec.kinds.${a.kind}`, { defaultValue: a.kind })}</Td><Td className="max-w-xs truncate text-xs">{a.testCodes.join(", ") || a.packageCode || "-"}</Td><Td><StatusBadge value={a.status} /></Td>
                <Td>{can("appointments.manage") && a.status === "BOOKED" ? <div className="flex gap-1"><Button size="sm" onClick={() => appt.mutate({ id: a.id, act: "check-in" })}>{t("rec.checkIn")}</Button><Button size="sm" variant="ghost" onClick={() => appt.mutate({ id: a.id, act: "no-show" })}>{t("rec.noShow")}</Button><Button size="sm" variant="ghost" onClick={() => appt.mutate({ id: a.id, act: "cancel" })}>{t("common.cancel")}</Button></div> : a.orderId ? <Link className="text-xs text-primary hover:underline" to={`/orders/${a.orderId}`}>{t("rec.openOrder")}</Link> : null}</Td>
              </tr>
            ))}
          </Table>
          {appts.data && !appts.data.length ? <EmptyState compact title={t("common.none")} /> : null}
          <p className="text-xs text-muted-foreground">{t("rec.apptNote", { date: today() })}</p>
        </div>
      )}
      <Modal open={Boolean(book)} onClose={() => setBook(null)} title={t("rec.book")}>
        {book ? <div className="space-y-3">
          <Field label={t("orders.fullName")}><Input value={book.patientName} onChange={(e) => setBook({ ...book, patientName: e.target.value })} autoFocus /></Field>
          <div className="grid grid-cols-2 gap-3"><Field label={t("orders.phone")}><Input value={book.phone} onChange={(e) => setBook({ ...book, phone: e.target.value })} /></Field><Field label={t("common.time")}><Input type="time" value={book.time} onChange={(e) => setBook({ ...book, time: e.target.value })} /></Field></div>
          <Field label={t("rec.kind")}><Select value={book.kind} onChange={(e) => setBook({ ...book, kind: e.target.value })}>{["WALK_IN", "PACKAGE", "FOLLOW_UP"].map((k) => <option key={k} value={k}>{t(`rec.kinds.${k}`)}</option>)}</Select></Field>
          <Field label={t("orders.tests")} hint={t("rec.testsHint")}><Input value={book.tests} onChange={(e) => setBook({ ...book, tests: e.target.value })} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={book.fasting} onChange={(e) => setBook({ ...book, fasting: e.target.checked })} />{t("rec.fasting")}</label>
          <ErrorNote error={bookM.error} />
          <Button disabled={book.patientName.length < 2 || bookM.isPending} onClick={() => bookM.mutate()}>{t("rec.book")}</Button>
        </div> : null}
      </Modal>
      <span className="sr-only">{dt(new Date(), i18n.language)}</span>
    </>
  );
}
