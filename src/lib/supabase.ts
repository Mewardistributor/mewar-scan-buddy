import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://tksdkybumxbbjwklnswg.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_wvd76OzCXtXyronsOie5DQ_ba3Vj4Nw";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: {
    fetch: (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      if (headers.get("Authorization") === `Bearer ${SUPABASE_PUBLISHABLE_KEY}`) {
        headers.delete("Authorization");
      }
      headers.set("apikey", SUPABASE_PUBLISHABLE_KEY);
      return fetch(input, { ...init, headers });
    },
  },
});

export type AppUser = {
  id: string;
  username: string;
  role: "admin" | "uploader" | "driver";
  driver_id: string | null;
};

export type Summary = {
  id: string;
  title: string;
  status: "in_progress" | "done";
  uploaded_by: string | null;
  shared_with_uploaders: boolean | null;
  created_at: string;
};

export type ProductStatus = "pending" | "match" | "short" | "excess" | "removed";

export type Product = {
  id: string;
  summary_id: string;
  barcode: string | null;
  product_name: string | null;
  required_mrp: number | null;
  required_box: number | null;
  required_pcs: number | null;
  completed_mrp: number | null;
  completed_box: number | null;
  completed_pcs: number | null;
  status: ProductStatus;
  change_note: string | null;
  created_at: string;
};

export function computeStatus(
  reqBox: number,
  reqPcs: number,
  compBox: number,
  compPcs: number,
): ProductStatus {
  if (compBox === reqBox && compPcs === reqPcs) return "match";
  if (compBox > reqBox || compPcs > reqPcs) return "excess";
  return "short";
}
export type Bill = {
  id: string;
  shop_name: string;
  owner_name: string | null;
  bill_number: string;
  bill_date: string | null;
  total_amount: number;
  source_file_name: string | null;
  uploaded_by: string | null;
  status: "active" | "cancelled";
  created_at: string;
};

export type BillItem = {
  id: string;
  bill_id: string;
  product_name: string;
  cases: number;
  pieces: number;
  amount: number;
  created_at: string;
};
export type Chalan = {
  id: string;
  bill_id: string | null;
  chalan_number: string | null;
  sno: number | null;
  bill_number: string;
  chalan_date: string | null;
  party_name: string;
  bill_value: number;
  boxes: string | null;
  remarks: string | null;
  driver_id: string | null;
  vehicle_km: number | null;
  status: "pending" | "dispatched" | "delivered" | "verified";
  source_file_name: string | null;
  uploaded_by: string | null;
  created_at: string;
  delivery_status: "pending" | "completed" | "not_delivered";
  amount_received: number | null;
  payment_type: "cash" | "online" | "cheque" | null;
  cash_denominations: Record<string, number> | null;
  payment_photo_url: string | null;
  not_delivered_reason: string | null;
  delivered_at: string | null;
  route_locked: boolean;
};
export type MatchingRun = {
  id: string;
  run_by: string | null;
  total_chalans: number;
  matched_count: number;
  unmatched_count: number;
  created_at: string;
};
export type MatchingResult = {
  id: string;
  matching_run_id: string;
  chalan_id: string;
  bill_id: string | null;
  match_method: "bill_number" | "shop_and_date" | "shop_only" | "unmatched";
  created_at: string;
};
export type Driver = {
  id: string;
  name: string;
  phone: string | null;
  vehicle_number: string | null;
  status: "active" | "inactive";
  created_at: string;
};
export type ShopVerification = {
  id: string;
  chalan_id: string;
  verified_by: string | null;
  verification_status: "pending" | "match" | "mismatch";
  total_cases: number | null;
  total_pieces: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type VerificationItem = {
  id: string;
  shop_verification_id: string;
  bill_item_id: string | null;
  product_name: string;
  expected_cases: number;
  expected_pieces: number;
  is_checked: boolean;
  created_at: string;
};
