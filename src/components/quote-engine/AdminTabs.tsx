import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Save, AlertTriangle, Building2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";

export function AdminTabs() {
  return (
    <Tabs defaultValue="carriers" className="space-y-4">
      <TabsList className="flex flex-wrap h-auto gap-1 bg-muted/50 p-1">
        <TabsTrigger value="carriers" className="text-xs">Carriers</TabsTrigger>
        <TabsTrigger value="products" className="text-xs">Products</TabsTrigger>
        <TabsTrigger value="rates" className="text-xs">Rates</TabsTrigger>
        <TabsTrigger value="knockouts" className="text-xs">Underwriting</TabsTrigger>
        <TabsTrigger value="conditions" className="text-xs">Conditions</TabsTrigger>
        <TabsTrigger value="medications" className="text-xs">Medications</TabsTrigger>
        <TabsTrigger value="commissions" className="text-xs">Commissions</TabsTrigger>
        <TabsTrigger value="payments" className="text-xs">Payments</TabsTrigger>
        <TabsTrigger value="badges" className="text-xs">Badges</TabsTrigger>
        <TabsTrigger value="weights" className="text-xs">Scoring</TabsTrigger>
        <TabsTrigger value="sources" className="text-xs">Source Docs</TabsTrigger>
      </TabsList>

      <TabsContent value="carriers"><CarriersTab /></TabsContent>
      <TabsContent value="products"><ProductsTab /></TabsContent>
      <TabsContent value="rates"><RatesTab /></TabsContent>
      <TabsContent value="knockouts"><KnockoutsTab /></TabsContent>
      <TabsContent value="conditions"><ConditionsTab /></TabsContent>
      <TabsContent value="medications"><MedicationsTab /></TabsContent>
      <TabsContent value="commissions"><CommissionsTab /></TabsContent>
      <TabsContent value="payments"><PaymentsTab /></TabsContent>
      <TabsContent value="badges"><BadgesTab /></TabsContent>
      <TabsContent value="weights"><WeightsTab /></TabsContent>
      <TabsContent value="sources"><SourceDocsTab /></TabsContent>
    </Tabs>
  );
}

// ─── Carriers ──────────────────────────────────────────
function CarriersTab() {
  const [carriers, setCarriers] = useState<any[]>([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  const load = async () => {
    const { data } = await supabase.from("qe_carriers").select("*").order("name");
    setCarriers(data ?? []);
  };

  useEffect(() => { load(); }, []);

  const add = async () => {
    if (!name.trim()) return;
    setLoading(true);
    const { error } = await supabase.from("qe_carriers").insert({ name: name.trim() });
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: "Carrier added" }); setName(""); load(); }
    setLoading(false);
  };

  const toggleActive = async (id: string, active: boolean) => {
    await supabase.from("qe_carriers").update({ is_active: !active }).eq("id", id);
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this carrier and all its products?")) return;
    await supabase.from("qe_carriers").delete().eq("id", id);
    load();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2"><Building2 className="h-4 w-4" /> Carrier Management</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input placeholder="Carrier name" value={name} onChange={(e) => setName(e.target.value)} className="flex-1" />
          <Button onClick={add} disabled={loading} size="sm"><Plus className="h-4 w-4 mr-1" /> Add</Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow><TableHead className="text-xs">Name</TableHead><TableHead className="text-xs w-20">Active</TableHead><TableHead className="text-xs w-16" /></TableRow>
          </TableHeader>
          <TableBody>
            {carriers.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="text-sm font-medium">{c.name}</TableCell>
                <TableCell><Switch checked={c.is_active} onCheckedChange={() => toggleActive(c.id, c.is_active)} /></TableCell>
                <TableCell><Button variant="ghost" size="icon" onClick={() => remove(c.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button></TableCell>
              </TableRow>
            ))}
            {carriers.length === 0 && (
              <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground text-sm py-8">No carriers added yet</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ─── Products ──────────────────────────────────────────
function ProductsTab() {
  const [products, setProducts] = useState<any[]>([]);
  const [carriers, setCarriers] = useState<any[]>([]);
  const [form, setForm] = useState({ carrier_id: "", name: "", category: "final_expense", min_age: "0", max_age: "85", min_face: "1000", max_face: "50000" });

  const load = async () => {
    const [{ data: p }, { data: c }] = await Promise.all([
      supabase.from("qe_products").select("*, qe_carriers(name)").order("name"),
      supabase.from("qe_carriers").select("id, name").eq("is_active", true).order("name"),
    ]);
    setProducts(p ?? []);
    setCarriers(c ?? []);
  };

  useEffect(() => { load(); }, []);

  const add = async () => {
    if (!form.carrier_id || !form.name.trim()) return;
    const { error } = await supabase.from("qe_products").insert([{
      carrier_id: form.carrier_id, name: form.name.trim(), category: form.category as any,
      min_age: parseInt(form.min_age), max_age: parseInt(form.max_age),
      min_face: parseFloat(form.min_face), max_face: parseFloat(form.max_face),
    }]);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: "Product added" }); setForm({ ...form, name: "" }); load(); }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this product?")) return;
    await supabase.from("qe_products").delete().eq("id", id);
    load();
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Product Management</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Select value={form.carrier_id} onValueChange={(v) => setForm({ ...form, carrier_id: v })}>
            <SelectTrigger className="text-xs"><SelectValue placeholder="Carrier" /></SelectTrigger>
            <SelectContent>{carriers.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
          </Select>
          <Input placeholder="Product name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="text-xs" />
          <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
            <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="final_expense">Final Expense</SelectItem>
              <SelectItem value="si_whole_life">SI Whole Life</SelectItem>
              <SelectItem value="si_ul">SI UL</SelectItem>
              <SelectItem value="mortgage_protection">Mortgage Protection</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={add} size="sm"><Plus className="h-4 w-4 mr-1" /> Add</Button>
        </div>
        <div className="grid grid-cols-4 gap-2">
          <div><Label className="text-[10px]">Min Age</Label><Input type="number" value={form.min_age} onChange={(e) => setForm({ ...form, min_age: e.target.value })} className="text-xs h-8" /></div>
          <div><Label className="text-[10px]">Max Age</Label><Input type="number" value={form.max_age} onChange={(e) => setForm({ ...form, max_age: e.target.value })} className="text-xs h-8" /></div>
          <div><Label className="text-[10px]">Min Face</Label><Input type="number" value={form.min_face} onChange={(e) => setForm({ ...form, min_face: e.target.value })} className="text-xs h-8" /></div>
          <div><Label className="text-[10px]">Max Face</Label><Input type="number" value={form.max_face} onChange={(e) => setForm({ ...form, max_face: e.target.value })} className="text-xs h-8" /></div>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Carrier</TableHead>
              <TableHead className="text-xs">Product</TableHead>
              <TableHead className="text-xs">Category</TableHead>
              <TableHead className="text-xs">Ages</TableHead>
              <TableHead className="text-xs">Face</TableHead>
              <TableHead className="text-xs w-20">Verified</TableHead>
              <TableHead className="text-xs w-16" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="text-xs">{(p as any).qe_carriers?.name ?? "—"}</TableCell>
                <TableCell className="text-xs font-medium">{p.name}</TableCell>
                <TableCell><Badge variant="outline" className="text-[10px] capitalize">{p.category.replace('_', ' ')}</Badge></TableCell>
                <TableCell className="text-xs">{p.min_age}–{p.max_age}</TableCell>
                <TableCell className="text-xs">${p.min_face.toLocaleString()}–${p.max_face.toLocaleString()}</TableCell>
                <TableCell>{p.needs_verification ? <AlertTriangle className="h-4 w-4 text-amber-500" /> : <Badge className="text-[10px] bg-emerald-500">✓</Badge>}</TableCell>
                <TableCell><Button variant="ghost" size="icon" onClick={() => remove(p.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button></TableCell>
              </TableRow>
            ))}
            {products.length === 0 && (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground text-sm py-8">No products added yet</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ─── Rates (simplified for Phase 1) ───────────────────
function RatesTab() {
  const [rates, setRates] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [form, setForm] = useState({ product_id: "", age: "", gender: "unisex", tobacco_class: "non_tobacco", rate_class: "standard", face_amount: "", monthly_premium: "" });

  const load = async () => {
    const [{ data: r }, { data: p }] = await Promise.all([
      supabase.from("qe_rate_tables").select("*, qe_products(name)").order("product_id").limit(100),
      supabase.from("qe_products").select("id, name").eq("is_active", true).order("name"),
    ]);
    setRates(r ?? []);
    setProducts(p ?? []);
  };

  useEffect(() => { load(); }, []);

  const add = async () => {
    if (!form.product_id || !form.age || !form.face_amount || !form.monthly_premium) return;
    const { error } = await supabase.from("qe_rate_tables").insert({
      product_id: form.product_id, age: parseInt(form.age), gender: form.gender,
      tobacco_class: form.tobacco_class, rate_class: form.rate_class,
      face_amount: parseFloat(form.face_amount), monthly_premium: parseFloat(form.monthly_premium),
    });
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: "Rate added" }); load(); }
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Rate Tables</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Select value={form.product_id} onValueChange={(v) => setForm({ ...form, product_id: v })}>
            <SelectTrigger className="text-xs"><SelectValue placeholder="Product" /></SelectTrigger>
            <SelectContent>{products.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
          </Select>
          <Input type="number" placeholder="Age" value={form.age} onChange={(e) => setForm({ ...form, age: e.target.value })} className="text-xs" />
          <Input type="number" placeholder="Face Amount" value={form.face_amount} onChange={(e) => setForm({ ...form, face_amount: e.target.value })} className="text-xs" />
          <Input type="number" placeholder="Monthly Premium" value={form.monthly_premium} onChange={(e) => setForm({ ...form, monthly_premium: e.target.value })} className="text-xs" />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Select value={form.gender} onValueChange={(v) => setForm({ ...form, gender: v })}>
            <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="unisex">Unisex</SelectItem>
              <SelectItem value="male">Male</SelectItem>
              <SelectItem value="female">Female</SelectItem>
            </SelectContent>
          </Select>
          <Select value={form.tobacco_class} onValueChange={(v) => setForm({ ...form, tobacco_class: v })}>
            <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="non_tobacco">Non-Tobacco</SelectItem>
              <SelectItem value="tobacco">Tobacco</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={add} size="sm"><Plus className="h-4 w-4 mr-1" /> Add Rate</Button>
        </div>
        <p className="text-xs text-muted-foreground">{rates.length} rate entries loaded (showing first 100)</p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Product</TableHead>
              <TableHead className="text-xs">Age</TableHead>
              <TableHead className="text-xs">Gender</TableHead>
              <TableHead className="text-xs">Tobacco</TableHead>
              <TableHead className="text-xs text-right">Face</TableHead>
              <TableHead className="text-xs text-right">Premium</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rates.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="text-xs">{(r as any).qe_products?.name ?? "—"}</TableCell>
                <TableCell className="text-xs">{r.age}</TableCell>
                <TableCell className="text-xs capitalize">{r.gender}</TableCell>
                <TableCell className="text-xs">{r.tobacco_class}</TableCell>
                <TableCell className="text-xs text-right">${r.face_amount.toLocaleString()}</TableCell>
                <TableCell className="text-xs text-right">${r.monthly_premium.toFixed(2)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ─── Knockouts ──────────────────────────────────────────
function KnockoutsTab() {
  const [rules, setRules] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [form, setForm] = useState({ product_id: "", rule_type: "condition", rule_key: "", severity: "knockout" });

  const load = async () => {
    const [{ data: r }, { data: p }] = await Promise.all([
      supabase.from("qe_underwriting_knockouts").select("*, qe_products(name)").order("product_id").limit(100),
      supabase.from("qe_products").select("id, name").eq("is_active", true).order("name"),
    ]);
    setRules(r ?? []);
    setProducts(p ?? []);
  };

  useEffect(() => { load(); }, []);

  const add = async () => {
    if (!form.product_id || !form.rule_key.trim()) return;
    const { error } = await supabase.from("qe_underwriting_knockouts").insert({
      product_id: form.product_id, rule_type: form.rule_type, rule_key: form.rule_key.trim(), severity: form.severity,
    });
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: "Rule added" }); setForm({ ...form, rule_key: "" }); load(); }
  };

  const remove = async (id: string) => {
    await supabase.from("qe_underwriting_knockouts").delete().eq("id", id);
    load();
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Underwriting Knockouts & Routing Rules</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <Select value={form.product_id} onValueChange={(v) => setForm({ ...form, product_id: v })}>
            <SelectTrigger className="text-xs"><SelectValue placeholder="Product" /></SelectTrigger>
            <SelectContent>{products.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={form.rule_type} onValueChange={(v) => setForm({ ...form, rule_type: v })}>
            <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="condition">Condition</SelectItem>
              <SelectItem value="medication">Medication</SelectItem>
              <SelectItem value="build">Build</SelectItem>
              <SelectItem value="age">Age</SelectItem>
            </SelectContent>
          </Select>
          <Input placeholder="Rule key (e.g., dialysis)" value={form.rule_key} onChange={(e) => setForm({ ...form, rule_key: e.target.value })} className="text-xs" />
          <Select value={form.severity} onValueChange={(v) => setForm({ ...form, severity: v })}>
            <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="knockout">Knockout</SelectItem>
              <SelectItem value="graded">Routes to Graded</SelectItem>
              <SelectItem value="modified">Routes to Modified</SelectItem>
              <SelectItem value="warning">Warning Only</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={add} size="sm"><Plus className="h-4 w-4 mr-1" /> Add</Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Product</TableHead>
              <TableHead className="text-xs">Type</TableHead>
              <TableHead className="text-xs">Key</TableHead>
              <TableHead className="text-xs">Severity</TableHead>
              <TableHead className="text-xs w-16" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rules.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="text-xs">{(r as any).qe_products?.name ?? "—"}</TableCell>
                <TableCell><Badge variant="outline" className="text-[10px]">{r.rule_type}</Badge></TableCell>
                <TableCell className="text-xs font-mono">{r.rule_key}</TableCell>
                <TableCell><Badge variant={r.severity === 'knockout' ? 'destructive' : 'outline'} className="text-[10px]">{r.severity}</Badge></TableCell>
                <TableCell><Button variant="ghost" size="icon" onClick={() => remove(r.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ─── Conditions ──────────────────────────────────────────
function ConditionsTab() {
  const [conditions, setConditions] = useState<any[]>([]);
  const [form, setForm] = useState({ name: "", category: "other", synonyms: "" });

  const load = async () => {
    const { data } = await supabase.from("qe_conditions").select("*").order("name");
    setConditions(data ?? []);
  };

  useEffect(() => { load(); }, []);

  const add = async () => {
    if (!form.name.trim()) return;
    const synonyms = form.synonyms.split(",").map(s => s.trim()).filter(Boolean);
    const { error } = await supabase.from("qe_conditions").insert([{ name: form.name.trim(), category: form.category as any, synonyms }]);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: "Condition added" }); setForm({ name: "", category: "other", synonyms: "" }); load(); }
  };

  const remove = async (id: string) => {
    await supabase.from("qe_conditions").delete().eq("id", id);
    load();
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Health Conditions Library</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Input placeholder="Condition name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="text-xs" />
          <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
            <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {["cardiac","respiratory","cancer","neurological","psychiatric","renal","liver","mobility_adl","autoimmune","metabolic","other"].map(c => (
                <SelectItem key={c} value={c}>{c.replace('_', ' ')}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input placeholder="Synonyms (comma-separated)" value={form.synonyms} onChange={(e) => setForm({ ...form, synonyms: e.target.value })} className="text-xs" />
          <Button onClick={add} size="sm"><Plus className="h-4 w-4 mr-1" /> Add</Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Name</TableHead>
              <TableHead className="text-xs">Category</TableHead>
              <TableHead className="text-xs">Synonyms</TableHead>
              <TableHead className="text-xs w-16" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {conditions.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="text-xs font-medium">{c.name}</TableCell>
                <TableCell><Badge variant="outline" className="text-[10px] capitalize">{c.category.replace('_', ' ')}</Badge></TableCell>
                <TableCell className="text-xs text-muted-foreground">{c.synonyms?.join(", ") || "—"}</TableCell>
                <TableCell><Button variant="ghost" size="icon" onClick={() => remove(c.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button></TableCell>
              </TableRow>
            ))}
            {conditions.length === 0 && (
              <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground text-sm py-8">No conditions added yet</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ─── Medications ──────────────────────────────────────────
function MedicationsTab() {
  const [meds, setMeds] = useState<any[]>([]);
  const [form, setForm] = useState({ name: "", generic_name: "", category: "other", brand_names: "" });

  const load = async () => {
    const { data } = await supabase.from("qe_medications").select("*").order("name");
    setMeds(data ?? []);
  };

  useEffect(() => { load(); }, []);

  const add = async () => {
    if (!form.name.trim()) return;
    const brand_names = form.brand_names.split(",").map(s => s.trim()).filter(Boolean);
    const { error } = await supabase.from("qe_medications").insert({ name: form.name.trim(), generic_name: form.generic_name.trim() || null, category: form.category, brand_names });
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: "Medication added" }); setForm({ name: "", generic_name: "", category: "other", brand_names: "" }); load(); }
  };

  const remove = async (id: string) => {
    await supabase.from("qe_medications").delete().eq("id", id);
    load();
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Medications Library</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <Input placeholder="Medication name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="text-xs" />
          <Input placeholder="Generic name" value={form.generic_name} onChange={(e) => setForm({ ...form, generic_name: e.target.value })} className="text-xs" />
          <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
            <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {["cardiac","respiratory","cancer","neurological","psychiatric","renal","liver","mobility_adl","autoimmune","metabolic","other"].map(c => (
                <SelectItem key={c} value={c}>{c.replace('_', ' ')}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input placeholder="Brand names (comma-separated)" value={form.brand_names} onChange={(e) => setForm({ ...form, brand_names: e.target.value })} className="text-xs" />
          <Button onClick={add} size="sm"><Plus className="h-4 w-4 mr-1" /> Add</Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Name</TableHead>
              <TableHead className="text-xs">Generic</TableHead>
              <TableHead className="text-xs">Category</TableHead>
              <TableHead className="text-xs w-16" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {meds.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="text-xs font-medium">{m.name}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{m.generic_name || "—"}</TableCell>
                <TableCell><Badge variant="outline" className="text-[10px] capitalize">{m.category.replace('_', ' ')}</Badge></TableCell>
                <TableCell><Button variant="ghost" size="icon" onClick={() => remove(m.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ─── Commissions ──────────────────────────────────────────
function CommissionsTab() {
  const [comms, setComms] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [form, setForm] = useState({ product_id: "", first_year_pct: "", renewal_pct: "", advance_months: "0" });

  const load = async () => {
    const [{ data: c }, { data: p }] = await Promise.all([
      supabase.from("qe_commission_schedules").select("*, qe_products(name)").order("product_id"),
      supabase.from("qe_products").select("id, name").eq("is_active", true).order("name"),
    ]);
    setComms(c ?? []);
    setProducts(p ?? []);
  };

  useEffect(() => { load(); }, []);

  const add = async () => {
    if (!form.product_id || !form.first_year_pct) return;
    const { error } = await supabase.from("qe_commission_schedules").insert({
      product_id: form.product_id, first_year_pct: parseFloat(form.first_year_pct),
      renewal_pct: form.renewal_pct ? parseFloat(form.renewal_pct) : 0,
      advance_months: parseInt(form.advance_months) || 0,
    });
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: "Commission added" }); load(); }
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Commission Schedules</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <Select value={form.product_id} onValueChange={(v) => setForm({ ...form, product_id: v })}>
            <SelectTrigger className="text-xs"><SelectValue placeholder="Product" /></SelectTrigger>
            <SelectContent>{products.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
          </Select>
          <Input type="number" placeholder="FY %" value={form.first_year_pct} onChange={(e) => setForm({ ...form, first_year_pct: e.target.value })} className="text-xs" />
          <Input type="number" placeholder="Renewal %" value={form.renewal_pct} onChange={(e) => setForm({ ...form, renewal_pct: e.target.value })} className="text-xs" />
          <Input type="number" placeholder="Advance months" value={form.advance_months} onChange={(e) => setForm({ ...form, advance_months: e.target.value })} className="text-xs" />
          <Button onClick={add} size="sm"><Plus className="h-4 w-4 mr-1" /> Add</Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Product</TableHead>
              <TableHead className="text-xs text-right">FY %</TableHead>
              <TableHead className="text-xs text-right">Renewal %</TableHead>
              <TableHead className="text-xs text-right">Advance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {comms.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="text-xs">{(c as any).qe_products?.name ?? "—"}</TableCell>
                <TableCell className="text-xs text-right font-mono">{c.first_year_pct}%</TableCell>
                <TableCell className="text-xs text-right font-mono">{c.renewal_pct ?? 0}%</TableCell>
                <TableCell className="text-xs text-right">{c.advance_months ?? 0} mo</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ─── Payments ──────────────────────────────────────────
function PaymentsTab() {
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Payment Methods per Product</CardTitle></CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Configure which payment methods each product supports (EFT, Social Security billing, Direct Express, Credit Card).
          Add entries via the product configuration. This panel will be expanded in Phase 2.
        </p>
      </CardContent>
    </Card>
  );
}

// ─── Badges ──────────────────────────────────────────
function BadgesTab() {
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Product Feature Badges</CardTitle></CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Configure feature badges (SS, DE, CC, PI, RA, GI, GR, IM) per product. This panel will be expanded in Phase 2.
        </p>
      </CardContent>
    </Card>
  );
}

// ─── Scoring Weights ──────────────────────────────────────────
function WeightsTab() {
  const [weights, setWeights] = useState<any>(null);

  const load = async () => {
    const { data } = await supabase.from("qe_scoring_weights").select("*").eq("is_default", true).single();
    setWeights(data);
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!weights) return;
    const { error } = await supabase.from("qe_scoring_weights").update({
      approval_weight: weights.approval_weight,
      suitability_weight: weights.suitability_weight,
      premium_weight: weights.premium_weight,
      commission_weight: weights.commission_weight,
      placement_weight: weights.placement_weight,
      persistency_weight: weights.persistency_weight,
    }).eq("id", weights.id);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else toast({ title: "Weights saved" });
  };

  if (!weights) return <Card><CardContent className="py-8 text-center text-muted-foreground">Loading...</CardContent></Card>;

  const total = weights.approval_weight + weights.suitability_weight + weights.premium_weight + weights.commission_weight + weights.placement_weight + weights.persistency_weight;

  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Scoring Formula Weights</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">Weights should sum to 1.0. Current total: <span className={total === 1 ? "text-emerald-600 font-bold" : "text-destructive font-bold"}>{total.toFixed(2)}</span></p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {[
            { key: "approval_weight", label: "Approval" },
            { key: "suitability_weight", label: "Suitability" },
            { key: "premium_weight", label: "Premium" },
            { key: "commission_weight", label: "Commission" },
            { key: "placement_weight", label: "Placement" },
            { key: "persistency_weight", label: "Persistency" },
          ].map(({ key, label }) => (
            <div key={key}>
              <Label className="text-xs">{label}</Label>
              <Input
                type="number"
                step="0.05"
                value={weights[key]}
                onChange={(e) => setWeights({ ...weights, [key]: parseFloat(e.target.value) || 0 })}
                className="mt-1"
              />
            </div>
          ))}
        </div>
        <Button onClick={save}><Save className="h-4 w-4 mr-2" /> Save Weights</Button>
      </CardContent>
    </Card>
  );
}

// ─── Source Docs ──────────────────────────────────────────
function SourceDocsTab() {
  const [docs, setDocs] = useState<any[]>([]);

  const load = async () => {
    const { data } = await supabase.from("qe_source_documents").select("*, qe_carriers(name)").order("uploaded_at", { ascending: false });
    setDocs(data ?? []);
  };

  useEffect(() => { load(); }, []);

  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Source Document Registry</CardTitle></CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground mb-4">Track the source and verification status of all carrier data used in recommendations.</p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Carrier</TableHead>
              <TableHead className="text-xs">Document</TableHead>
              <TableHead className="text-xs">Type</TableHead>
              <TableHead className="text-xs">Status</TableHead>
              <TableHead className="text-xs">Effective</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {docs.map((d) => (
              <TableRow key={d.id}>
                <TableCell className="text-xs">{(d as any).qe_carriers?.name ?? "—"}</TableCell>
                <TableCell className="text-xs font-medium">{d.doc_name}</TableCell>
                <TableCell className="text-xs">{d.doc_type}</TableCell>
                <TableCell>
                  <Badge variant={d.confidence_status === 'verified' ? 'default' : d.confidence_status === 'stale' ? 'destructive' : 'outline'} className="text-[10px]">
                    {d.confidence_status}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs">{d.effective_date ?? "—"}</TableCell>
              </TableRow>
            ))}
            {docs.length === 0 && (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground text-sm py-8">No source documents registered yet</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
