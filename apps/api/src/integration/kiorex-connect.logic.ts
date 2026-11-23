import type { ConnectStatus, ConnectStep, StepStatus } from "./kiorex-connect.core";

/** Kiorly Lab: step checklist computed from real state (pure). */
export interface LabConnectFacts {
  status: ConnectStatus;
  labs: number;
  activeTests: number;
  pricedTests: number;
  labsMissingHours: number;
  labsMissingLicenceNo: number;
  licenceDocument: boolean;
  homeCollectionConfigured: boolean;
  payoutLabel: boolean;
  termsAccepted: boolean;
  liveOnKiorex: boolean;
}
export function computeLabSteps(f: LabConnectFacts): ConnectStep[] {
  const s: ConnectStep[] = [];
  s.push({ key: "lab_site", status: f.labs > 0 ? "done" : "action_needed", link: "/settings", detail: { labs: f.labs } });
  s.push({ key: "catalogue", status: f.activeTests > 0 ? "done" : "action_needed", link: "/catalogue", detail: { tests: f.activeTests } });
  s.push({ key: "price_list", status: f.activeTests > 0 && f.pricedTests >= f.activeTests ? "done" : "action_needed", link: "/catalogue", detail: { priced: f.pricedTests, tests: f.activeTests, unpriced: Math.max(0, f.activeTests - f.pricedTests) } });
  s.push({ key: "hours_collection", status: f.labs > 0 && f.labsMissingHours === 0 ? "done" : "action_needed", link: "/settings", detail: { missing: f.labsMissingHours } });
  s.push({ key: "home_collection", status: f.homeCollectionConfigured ? "done" : "action_needed", optional: true, link: "/settings", detail: {} });
  s.push({ key: "licence", status: f.labs > 0 && f.labsMissingLicenceNo === 0 && f.licenceDocument ? "done" : "action_needed", link: "/settings", detail: { labsMissingLicenceNo: f.labsMissingLicenceNo, document: f.licenceDocument } });
  s.push({ key: "payout", status: f.payoutLabel ? "done" : "action_needed", detail: {} });
  s.push({ key: "terms", status: f.termsAccepted ? "done" : "action_needed", detail: {} });
  const prereq = s.filter((x) => !x.optional).every((x) => x.status === "done");
  const requested: StepStatus = f.status === "APPROVED" ? "done" : ["REQUESTED", "PAUSED"].includes(f.status) ? "waiting_kiorex" : prereq ? "action_needed" : "blocked";
  s.push({ key: "request", status: f.status === "CHANGES_REQUESTED" || f.status === "REJECTED" ? (prereq ? "action_needed" : "blocked") : requested, detail: { connectStatus: f.status } });
  s.push({ key: "live", status: f.status === "APPROVED" && f.liveOnKiorex ? "done" : "blocked", detail: {} });
  return s;
}
