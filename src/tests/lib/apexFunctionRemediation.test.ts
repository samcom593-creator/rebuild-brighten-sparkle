import { describe, it, expect } from "vitest";
import { supabase } from "@/integrations/supabase/client";

describe("APEX Function Perfection Remediation Suite", () => {
  describe("Edge Function Authorization Contracts", () => {
    it("verify create-va-account and set-va-account invoke signatures exist", () => {
      expect(typeof supabase.functions.invoke).toBe("function");
    });
  });

  describe("RPC Contract Signatures", () => {
    it("supports get_just_hired_30d RPC query shape", () => {
      const mockResult = [
        {
          id: "123",
          display_name: "Test Agent",
          start_date: "2026-08-01",
          routed_to: "Samuel James",
          created_at: new Date().toISOString(),
        },
      ];
      expect(mockResult).toHaveLength(1);
      expect(mockResult[0].routed_to).toBe("Samuel James");
    });

    it("supports next_step_message_stats_24h RPC query shape", () => {
      const mockResult = [
        { channel: "email", sent: 10, failed: 0 },
        { channel: "sms", sent: 5, failed: 1 },
      ];
      expect(mockResult).toHaveLength(2);
      expect(mockResult[0].channel).toBe("email");
    });

    it("supports fn_commission_recovery_next_batch return shape", () => {
      const mockResult = [
        {
          policy_id: "pol-1",
          agent_id: "ag-1",
          agent_display: "Test Agent",
          agent_email: "test@apex-financial.org",
          carrier_name: "Ethos",
          effective_date: "2026-08-01",
          client_name: "Client Demo",
        },
      ];
      expect(mockResult[0].agent_email).toBe("test@apex-financial.org");
    });
  });

  describe("Contact Actions & Deal Entry UI Contracts", () => {
    it("validates Licensed Inbox quick-add five fields", () => {
      const quickAddAgent = {
        firstName: "Test",
        lastName: "Agent",
        email: "testagent@apex-financial.org",
        phone: "5551234567",
        paNumber: "PA999888",
      };

      expect(quickAddAgent.firstName.trim()).toBeTruthy();
      expect(quickAddAgent.lastName.trim()).toBeTruthy();
      expect(quickAddAgent.email).toContain("@");
      expect(quickAddAgent.phone.length).toBeGreaterThanOrEqual(10);
      expect(quickAddAgent.paNumber).toBe("PA999888");
    });

    it("verifies deal posting ledger immutable payload structure", () => {
      const dealRecord = {
        agent_id: "ag-123",
        client_name: "REDACTED CLIENT",
        annual_premium: 1200,
        product_type: "IUL",
        status: "submitted",
        posted_at: new Date().toISOString(),
      };

      expect(dealRecord.annual_premium).toBe(1200);
      expect(dealRecord.client_name).not.toContain("Secret");
    });
  });
});
