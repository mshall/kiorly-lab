import type { Edition, StaffRole } from "../generated/prisma/client";

export interface AuthUser {
  staffId: string;
  orgId: string;
  role: StaffRole;
  displayName: string;
  labIds: string[];
  marketCode: string;
  edition: Edition;
  signatoryLicenceNo: string | null;
}

export interface AuthedRequest {
  user?: AuthUser;
  headers: Record<string, string | string[] | undefined>;
  method: string;
  originalUrl: string;
  route?: { path?: string };
  rawBody?: Buffer;
}
