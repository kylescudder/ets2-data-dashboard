import { redirect } from "next/navigation";
import { supabaseServer } from "../../lib/supabase/server";
import { ProfileForm } from "../../components/ProfileForm";

export default async function ProfilePage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("users")
    .select("id, name, display_name, avatar_url")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Profile</h1>
      {profile ? (
        <ProfileForm initial={profile} />
      ) : (
        <div className="rounded-lg border border-edge bg-panel p-5 text-slate-400 text-sm">
          No profile row found for your account. The signup trigger normally
          creates one — try signing out and back in. If that doesn&apos;t fix it,
          something is up with the <code>on_auth_user_created</code> trigger.
        </div>
      )}
    </div>
  );
}
