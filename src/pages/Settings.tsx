import { ProfileSettings } from "@/components/dashboard/ProfileSettings";
import { CalendarSyncSection } from "@/components/dashboard/CalendarSyncSection";
import { IPhoneShortcutsSection } from "@/components/dashboard/IPhoneShortcutsSection";

export default function Settings() {
  return (
    <div className="space-y-4">
      <ProfileSettings />
      <div className="px-4 md:px-6 max-w-4xl space-y-4">
        <CalendarSyncSection />
        <IPhoneShortcutsSection />
      </div>
    </div>
  );
}
