import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/domain";
import { getCompanyGoogleInfo, getUserGoogleInfo, isGoogleConfigured } from "@/lib/google";
import ProfileClient from "./ProfileClient";

export const dynamic = "force-dynamic";

/** Profilo dell'utente loggato: dati, casella Gmail, password, PIN e firma. */
export default async function ProfilePage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  const [google, company] = await Promise.all([getUserGoogleInfo(user.id), getCompanyGoogleInfo()]);
  return (
    <ProfileClient
      user={{
        name: user.name,
        email: user.email,
        roleLabel: ROLE_LABEL[user.role],
        phone: user.phone,
        photo: user.photo,
        reparto: user.reparto,
        matricola: user.matricola,
        hasPin: !!user.pinHash,
        signatureImage: user.signatureImage,
      }}
      googleConfigured={isGoogleConfigured()}
      google={google}
      companyEmail={company?.email ?? null}
    />
  );
}
