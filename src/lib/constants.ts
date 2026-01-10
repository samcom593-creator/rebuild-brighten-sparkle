// US States for dropdowns
export const US_STATES = [
  { value: "AL", label: "Alabama" },
  { value: "AK", label: "Alaska" },
  { value: "AZ", label: "Arizona" },
  { value: "AR", label: "Arkansas" },
  { value: "CA", label: "California" },
  { value: "CO", label: "Colorado" },
  { value: "CT", label: "Connecticut" },
  { value: "DE", label: "Delaware" },
  { value: "FL", label: "Florida" },
  { value: "GA", label: "Georgia" },
  { value: "HI", label: "Hawaii" },
  { value: "ID", label: "Idaho" },
  { value: "IL", label: "Illinois" },
  { value: "IN", label: "Indiana" },
  { value: "IA", label: "Iowa" },
  { value: "KS", label: "Kansas" },
  { value: "KY", label: "Kentucky" },
  { value: "LA", label: "Louisiana" },
  { value: "ME", label: "Maine" },
  { value: "MD", label: "Maryland" },
  { value: "MA", label: "Massachusetts" },
  { value: "MI", label: "Michigan" },
  { value: "MN", label: "Minnesota" },
  { value: "MS", label: "Mississippi" },
  { value: "MO", label: "Missouri" },
  { value: "MT", label: "Montana" },
  { value: "NE", label: "Nebraska" },
  { value: "NV", label: "Nevada" },
  { value: "NH", label: "New Hampshire" },
  { value: "NJ", label: "New Jersey" },
  { value: "NM", label: "New Mexico" },
  { value: "NY", label: "New York" },
  { value: "NC", label: "North Carolina" },
  { value: "ND", label: "North Dakota" },
  { value: "OH", label: "Ohio" },
  { value: "OK", label: "Oklahoma" },
  { value: "OR", label: "Oregon" },
  { value: "PA", label: "Pennsylvania" },
  { value: "RI", label: "Rhode Island" },
  { value: "SC", label: "South Carolina" },
  { value: "SD", label: "South Dakota" },
  { value: "TN", label: "Tennessee" },
  { value: "TX", label: "Texas" },
  { value: "UT", label: "Utah" },
  { value: "VT", label: "Vermont" },
  { value: "VA", label: "Virginia" },
  { value: "WA", label: "Washington" },
  { value: "WV", label: "West Virginia" },
  { value: "WI", label: "Wisconsin" },
  { value: "WY", label: "Wyoming" },
];

export const AVAILABILITY_OPTIONS = [
  { value: "full-time", label: "Full-Time" },
  { value: "part-time", label: "Part-Time" },
  { value: "flexible", label: "Flexible" },
];

export const REFERRAL_SOURCES = [
  { value: "social-media", label: "Social Media" },
  { value: "friend-referral", label: "Friend/Family Referral" },
  { value: "agent-referral", label: "Agent Referral" },
  { value: "job-board", label: "Job Board" },
  { value: "google", label: "Google Search" },
  { value: "event", label: "Recruiting Event" },
  { value: "other", label: "Other" },
];

export const APPLICATION_STATUSES = {
  new: { label: "New", color: "bg-blue-500" },
  reviewing: { label: "Reviewing", color: "bg-yellow-500" },
  interview: { label: "Interview", color: "bg-purple-500" },
  contracting: { label: "Contracting", color: "bg-orange-500" },
  approved: { label: "Approved", color: "bg-green-500" },
  rejected: { label: "Rejected", color: "bg-red-500" },
} as const;

export const AGENT_STATUSES = {
  active: { label: "Active", color: "bg-green-500" },
  inactive: { label: "Inactive", color: "bg-gray-500" },
  pending: { label: "Pending", color: "bg-yellow-500" },
  terminated: { label: "Terminated", color: "bg-red-500" },
} as const;

export const RESOURCE_CATEGORIES = [
  "Onboarding",
  "Training",
  "Scripts",
  "Compliance",
  "Marketing",
  "Product Knowledge",
];

export const RESOURCE_TYPES = [
  { value: "video", label: "Video", icon: "Play" },
  { value: "document", label: "Document", icon: "FileText" },
  { value: "script", label: "Script", icon: "MessageSquare" },
  { value: "faq", label: "FAQ", icon: "HelpCircle" },
];