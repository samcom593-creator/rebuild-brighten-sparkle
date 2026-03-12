import { useState, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { ConditionSearch } from "./ConditionSearch";
import { MedicationSearch } from "./MedicationSearch";
import { US_STATES } from "@/lib/constants";
import { Calculator, ChevronDown, CalendarDays } from "lucide-react";
import { format, differenceInYears } from "date-fns";
import type { QuoteClientInput, QEProductCategory, SelectedCondition, SelectedMedication } from "@/lib/quoteEngineTypes";

interface QuoteInputFormProps {
  onSubmit: (input: QuoteClientInput) => void;
  loading?: boolean;
}

const CATEGORY_OPTIONS: { value: QEProductCategory; label: string }[] = [
  { value: "final_expense", label: "Final Expense" },
  { value: "si_whole_life", label: "Simplified Issue WL" },
  { value: "si_ul", label: "Simplified Issue UL" },
  { value: "mortgage_protection", label: "Mortgage Protection" },
  { value: "other", label: "Other" },
];

const PAYMENT_OPTIONS = [
  { value: "eft", label: "Bank Draft / EFT" },
  { value: "ss_billing", label: "Social Security Billing" },
  { value: "direct_express", label: "Direct Express / Debit" },
  { value: "credit_card", label: "Credit Card" },
];

export function QuoteInputForm({ onSubmit, loading }: QuoteInputFormProps) {
  const [solveMode, setSolveMode] = useState<'premium' | 'face_amount'>('premium');
  const [faceAmount, setFaceAmount] = useState<string>("10000");
  const [premium, setPremium] = useState<string>("");
  const [categories, setCategories] = useState<QEProductCategory[]>([]);
  const [state, setState] = useState("");
  const [sex, setSex] = useState<'male' | 'female'>('male');
  const [dob, setDob] = useState<Date | undefined>();
  const [heightFeet, setHeightFeet] = useState("5");
  const [heightInches, setHeightInches] = useState("6");
  const [weight, setWeight] = useState("");
  const [tobacco, setTobacco] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("eft");
  const [conditions, setConditions] = useState<SelectedCondition[]>([]);
  const [medications, setMedications] = useState<SelectedMedication[]>([]);
  const [showQualifiers, setShowQualifiers] = useState(false);

  // Additional qualifiers
  const [diabetesType, setDiabetesType] = useState("");
  const [insulinUse, setInsulinUse] = useState(false);
  const [a1c, setA1c] = useState("");
  const [oxygenUse, setOxygenUse] = useState(false);
  const [chfHistory, setChfHistory] = useState(false);
  const [strokeHistory, setStrokeHistory] = useState(false);
  const [heartAttackHistory, setHeartAttackHistory] = useState(false);
  const [kidneyDisease, setKidneyDisease] = useState(false);
  const [dialysis, setDialysis] = useState(false);
  const [liverDisease, setLiverDisease] = useState(false);
  const [mentalHealthHosp, setMentalHealthHosp] = useState(false);
  const [mobilityLimitations, setMobilityLimitations] = useState(false);
  const [adlLimitations, setAdlLimitations] = useState(false);
  const [nursingHome, setNursingHome] = useState(false);
  const [duiHistory, setDuiHistory] = useState(false);

  const age = useMemo(() => {
    if (!dob) return 0;
    return differenceInYears(new Date(), dob);
  }, [dob]);

  const bmi = useMemo(() => {
    const h = parseInt(heightFeet) * 12 + parseInt(heightInches || "0");
    const w = parseFloat(weight);
    if (!h || !w || h === 0) return 0;
    return Math.round((w / (h * h)) * 703 * 10) / 10;
  }, [heightFeet, heightInches, weight]);

  const toggleCategory = (cat: QEProductCategory) => {
    setCategories(prev => prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]);
  };

  const handleSubmit = useCallback(() => {
    const input: QuoteClientInput = {
      faceAmount: solveMode === 'premium' ? parseFloat(faceAmount) || null : null,
      premium: solveMode === 'face_amount' ? parseFloat(premium) || null : null,
      solveMode,
      categories,
      state,
      sex,
      dob: dob ? format(dob, "yyyy-MM-dd") : "",
      age,
      heightFeet: parseInt(heightFeet) || 0,
      heightInches: parseInt(heightInches) || 0,
      weight: parseFloat(weight) || 0,
      bmi,
      tobacco,
      paymentMethod,
      conditions,
      medications,
      diabetesType: diabetesType || undefined,
      insulinUse: insulinUse || undefined,
      a1c: a1c ? parseFloat(a1c) : undefined,
      oxygenUse: oxygenUse || undefined,
      chfHistory: chfHistory || undefined,
      strokeHistory: strokeHistory || undefined,
      heartAttackHistory: heartAttackHistory || undefined,
      kidneyDisease: kidneyDisease || undefined,
      dialysis: dialysis || undefined,
      liverDisease: liverDisease || undefined,
      mentalHealthHospitalization: mentalHealthHosp || undefined,
      mobilityLimitations: mobilityLimitations || undefined,
      adlLimitations: adlLimitations || undefined,
      nursingHome: nursingHome || undefined,
      duiHistory: duiHistory || undefined,
    };
    onSubmit(input);
  }, [solveMode, faceAmount, premium, categories, state, sex, dob, age, heightFeet, heightInches, weight, bmi, tobacco, paymentMethod, conditions, medications, diabetesType, insulinUse, a1c, oxygenUse, chfHistory, strokeHistory, heartAttackHistory, kidneyDisease, dialysis, liverDisease, mentalHealthHosp, mobilityLimitations, adlLimitations, nursingHome, duiHistory, onSubmit]);

  return (
    <div className="space-y-4">
      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left: Coverage & Client Info */}
        <Card className="border-border/60">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Calculator className="h-4 w-4 text-primary" />
              Coverage & Client Info
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Solve Mode Toggle */}
            <div className="flex items-center gap-3 p-2 rounded-lg bg-muted/50">
              <Label className="text-xs font-medium">Solve for:</Label>
              <div className="flex bg-background rounded-md border border-border">
                <button
                  onClick={() => setSolveMode('premium')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-l-md transition-colors ${solveMode === 'premium' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  Premium
                </button>
                <button
                  onClick={() => setSolveMode('face_amount')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-r-md transition-colors ${solveMode === 'face_amount' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  Face Amount
                </button>
              </div>
            </div>

            {/* Face Amount / Premium */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Face Amount</Label>
                <Input
                  type="number"
                  placeholder="$10,000"
                  value={faceAmount}
                  onChange={(e) => setFaceAmount(e.target.value)}
                  disabled={solveMode === 'face_amount'}
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-xs">Monthly Premium</Label>
                <Input
                  type="number"
                  placeholder="$50.00"
                  value={premium}
                  onChange={(e) => setPremium(e.target.value)}
                  disabled={solveMode === 'premium'}
                  className="mt-1"
                />
              </div>
            </div>

            {/* Categories */}
            <div>
              <Label className="text-xs">Product Category</Label>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {CATEGORY_OPTIONS.map((cat) => (
                  <Badge
                    key={cat.value}
                    variant={categories.includes(cat.value) ? "default" : "outline"}
                    className="cursor-pointer text-xs"
                    onClick={() => toggleCategory(cat.value)}
                  >
                    {cat.label}
                  </Badge>
                ))}
              </div>
            </div>

            {/* State + Sex */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">State</Label>
                <Select value={state} onValueChange={setState}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Select state" />
                  </SelectTrigger>
                  <SelectContent>
                    {US_STATES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Sex</Label>
                <Select value={sex} onValueChange={(v) => setSex(v as 'male' | 'female')}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="male">Male</SelectItem>
                    <SelectItem value="female">Female</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* DOB + Age */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Date of Birth</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full mt-1 justify-start text-left font-normal text-sm">
                      <CalendarDays className="h-4 w-4 mr-2" />
                      {dob ? format(dob, "MM/dd/yyyy") : "Select DOB"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={dob}
                      onSelect={setDob}
                      captionLayout="dropdown-buttons"
                      fromYear={1920}
                      toYear={new Date().getFullYear()}
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div>
                <Label className="text-xs">Age (calculated)</Label>
                <div className="mt-1 h-10 flex items-center px-3 rounded-md border border-input bg-muted/30 text-sm font-mono">
                  {age > 0 ? age : "—"}
                </div>
              </div>
            </div>

            {/* Height, Weight, BMI */}
            <div className="grid grid-cols-4 gap-2">
              <div>
                <Label className="text-xs">Ft</Label>
                <Input type="number" value={heightFeet} onChange={(e) => setHeightFeet(e.target.value)} className="mt-1" min={3} max={7} />
              </div>
              <div>
                <Label className="text-xs">In</Label>
                <Input type="number" value={heightInches} onChange={(e) => setHeightInches(e.target.value)} className="mt-1" min={0} max={11} />
              </div>
              <div>
                <Label className="text-xs">Weight</Label>
                <Input type="number" placeholder="lbs" value={weight} onChange={(e) => setWeight(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label className="text-xs">BMI</Label>
                <div className="mt-1 h-10 flex items-center px-3 rounded-md border border-input bg-muted/30 text-sm font-mono">
                  {bmi > 0 ? bmi : "—"}
                </div>
              </div>
            </div>

            {/* Tobacco + Payment */}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center gap-3 p-2 rounded-lg bg-muted/50">
                <Switch checked={tobacco} onCheckedChange={setTobacco} />
                <Label className="text-xs">Tobacco / Nicotine</Label>
              </div>
              <div>
                <Label className="text-xs">Payment Method</Label>
                <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_OPTIONS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Right: Health Profile */}
        <Card className="border-border/60">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-destructive" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>
              Health Profile
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <ConditionSearch selected={conditions} onChange={setConditions} />
            <MedicationSearch selected={medications} onChange={setMedications} />

            {/* Additional Qualifiers */}
            <Collapsible open={showQualifiers} onOpenChange={setShowQualifiers}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" className="w-full justify-between text-xs text-muted-foreground">
                  Additional Underwriting Qualifiers
                  <ChevronDown className={`h-4 w-4 transition-transform ${showQualifiers ? "rotate-180" : ""}`} />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-3 pt-2">
                {/* Diabetes */}
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <Label className="text-xs">Diabetes</Label>
                    <Select value={diabetesType} onValueChange={setDiabetesType}>
                      <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue placeholder="None" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        <SelectItem value="type1">Type 1</SelectItem>
                        <SelectItem value="type2">Type 2</SelectItem>
                        <SelectItem value="pre">Pre-diabetic</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-end gap-2">
                    <div className="flex items-center gap-1.5">
                      <Checkbox checked={insulinUse} onCheckedChange={(v) => setInsulinUse(!!v)} />
                      <Label className="text-xs">Insulin</Label>
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">A1C</Label>
                    <Input type="number" placeholder="e.g. 7.2" value={a1c} onChange={(e) => setA1c(e.target.value)} className="mt-1 h-8 text-xs" step="0.1" />
                  </div>
                </div>

                {/* Condition checkboxes */}
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: "Oxygen Use", checked: oxygenUse, set: setOxygenUse },
                    { label: "CHF History", checked: chfHistory, set: setChfHistory },
                    { label: "Stroke / TIA", checked: strokeHistory, set: setStrokeHistory },
                    { label: "Heart Attack / Bypass / Stents", checked: heartAttackHistory, set: setHeartAttackHistory },
                    { label: "Kidney Disease", checked: kidneyDisease, set: setKidneyDisease },
                    { label: "Dialysis", checked: dialysis, set: setDialysis },
                    { label: "Liver Disease", checked: liverDisease, set: setLiverDisease },
                    { label: "Mental Health Hospitalization", checked: mentalHealthHosp, set: setMentalHealthHosp },
                    { label: "Mobility Limitations", checked: mobilityLimitations, set: setMobilityLimitations },
                    { label: "ADL Limitations", checked: adlLimitations, set: setAdlLimitations },
                    { label: "Nursing Home / Assisted Living", checked: nursingHome, set: setNursingHome },
                    { label: "DUI History", checked: duiHistory, set: setDuiHistory },
                  ].map((item) => (
                    <div key={item.label} className="flex items-center gap-2 p-1.5 rounded hover:bg-muted/50">
                      <Checkbox checked={item.checked} onCheckedChange={(v) => item.set(!!v)} />
                      <Label className="text-xs cursor-pointer">{item.label}</Label>
                    </div>
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          </CardContent>
        </Card>
      </div>

      {/* Submit */}
      <Button
        onClick={handleSubmit}
        disabled={loading || !state || !dob}
        className="w-full h-12 text-base font-bold"
        size="lg"
      >
        {loading ? "Running Quote Engine..." : "Get Recommendations"}
      </Button>
    </div>
  );
}
