import PortaleClient from "./PortaleClient";
import { isBrainConfigured } from "@/lib/brain/config";

export const dynamic = "force-dynamic";

export default function PortalePage() {
  return <PortaleClient brainConfigured={isBrainConfigured()} />;
}
