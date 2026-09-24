import { createContext, useContext } from "react";
import type { SessionInfo } from "../shared/types";

export const SessionContext = createContext<SessionInfo>({ permission: "read" });
export function useAccess() {
  const session = useContext(SessionContext);
  return { ...session, canWrite: session.permission !== "read", isOwner: session.permission === "owner" };
}
