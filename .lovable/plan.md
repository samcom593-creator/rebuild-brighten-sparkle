
# Add Agent Removal to Command Center

## Problem
The Command Center page has a three-dot menu button on each agent row, but clicking it does **nothing**. There's no dropdown menu connecting to the agent removal/termination workflow that already exists (`DeactivateAgentDialog` component).

## Solution
Add a `DropdownMenu` to the three-dot button in Command Center that provides:
1. **View/Edit Profile** - Opens the existing AgentProfileEditor sheet
2. **Terminate Agent** - Opens the existing DeactivateAgentDialog with full options:
   - Bad Business (immediate deactivation)
   - Add to Inactive Agents
   - Remove from System (email approval workflow)
   - Switch Teams (transfer to another manager)

---

## Technical Implementation

### File: `src/pages/DashboardCommandCenter.tsx`

**Changes required:**

1. **Add imports:**
   - `DropdownMenu`, `DropdownMenuContent`, `DropdownMenuItem`, `DropdownMenuSeparator`, `DropdownMenuTrigger` from `@/components/ui/dropdown-menu`
   - `DeactivateAgentDialog` from `@/components/dashboard/DeactivateAgentDialog`
   - `UserX`, `Pencil` icons from `lucide-react`

2. **Add state for deactivation dialog:**
   ```typescript
   const [deactivateAgent, setDeactivateAgent] = useState<AgentWithStats | null>(null);
   ```

3. **Replace the standalone button (lines 503-505):**
   ```typescript
   <Button variant="ghost" size="icon" className="h-8 w-8">
     <MoreVertical className="h-4 w-4" />
   </Button>
   ```
   
   With a full `DropdownMenu`:
   ```typescript
   <DropdownMenu>
     <DropdownMenuTrigger asChild>
       <Button 
         variant="ghost" 
         size="icon" 
         className="h-8 w-8"
         onClick={(e) => e.stopPropagation()}
       >
         <MoreVertical className="h-4 w-4" />
       </Button>
     </DropdownMenuTrigger>
     <DropdownMenuContent align="end">
       <DropdownMenuItem onClick={(e) => { 
         e.stopPropagation(); 
         setSelectedAgent(agent); 
       }}>
         <Pencil className="h-4 w-4 mr-2" />
         Edit Profile
       </DropdownMenuItem>
       <DropdownMenuSeparator />
       <DropdownMenuItem 
         className="text-destructive focus:text-destructive"
         onClick={(e) => { 
           e.stopPropagation(); 
           setDeactivateAgent(agent); 
         }}
       >
         <UserX className="h-4 w-4 mr-2" />
         Remove from Pipeline
       </DropdownMenuItem>
     </DropdownMenuContent>
   </DropdownMenu>
   ```

4. **Add the DeactivateAgentDialog component (before closing `</DashboardLayout>`):**
   ```typescript
   <DeactivateAgentDialog
     open={!!deactivateAgent}
     onOpenChange={(open) => !open && setDeactivateAgent(null)}
     agentId={deactivateAgent?.id || ""}
     agentName={deactivateAgent?.fullName || ""}
     onComplete={() => {
       refetch();
       setDeactivateAgent(null);
     }}
   />
   ```

---

## User Flow After Fix

1. Admin opens Command Center
2. Clicks three-dot menu on any agent row
3. Sees dropdown with:
   - **Edit Profile** → Opens side sheet for profile editing
   - **Remove from Pipeline** → Opens termination dialog with options:
     - Bad Business
     - Add to Inactive Agents
     - Remove from System (email approval)
     - Switch Teams

---

## Files Modified

| File | Change |
|------|--------|
| `src/pages/DashboardCommandCenter.tsx` | Add DropdownMenu with Edit/Remove options, integrate DeactivateAgentDialog |

---

## Expected Result

The three-dot menu in Command Center will now be fully functional, allowing admins to:
- Edit any agent's profile directly
- Remove agents from the pipeline via multiple methods
- Transfer agents to different teams
- All without leaving the Command Center view
