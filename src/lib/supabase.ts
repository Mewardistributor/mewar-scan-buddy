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
  role: "admin" | "uploader";
};

export type Summary = {
  id: string;
  title: string;
  status: "in_progress" | "done";
  uploaded_by: string | null;
  shared_with_uploaders: boolean | null;
  created_at: string;
};

export type ProductStatus = "pending" | "match" | "short" | "excess";

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
