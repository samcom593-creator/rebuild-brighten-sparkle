import React, { useState, useEffect, useCallback, useRef, createContext, useContext, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";

interface Profile {
  id: string;
  user_id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  avatar_url: string | null;
  bio: string | null;
  city: string | null;
  state: string | null;
  instagram_handle: string | null;
}

interface UserRole {
  role: "admin" | "manager" | "agent";
}

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  roles: UserRole[];
  isLoading: boolean;
  isAdmin: boolean;
  isManager: boolean;
  isAgent: boolean;
  hasRole: (role: "admin" | "manager" | "agent") => boolean;
  signUp: (email: string, password: string, fullName?: string) => Promise<any>;
  signIn: (email: string, password: string) => Promise<any>;
  signOut: () => Promise<{ error: any }>;
  refreshProfile: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<UserRole[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [rolesLoading, setRolesLoading] = useState(true);

  // Ref to track the last user ID we fetched data for — prevents duplicate fetches
  const lastFetchedUserId = useRef<string | null>(null);
  // Ref to track current user ID — prevents creating new user object references on token refresh
  const currentUserIdRef = useRef<string | null>(null);

  const fetchProfile = useCallback(async (userId: string, authEmail?: string) => {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    
    if (data && authEmail && data.email !== authEmail) {
      console.log("Syncing profile email with auth email:", authEmail);
      await supabase
        .from("profiles")
        .update({ email: authEmail })
        .eq("user_id", userId);
      
      const { data: updatedData } = await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();
      
      setProfile(updatedData);
    } else {
      setProfile(data);
    }
  }, []);

  const fetchRoles = useCallback(async (userId: string) => {
    setRolesLoading(true);
    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    
    setRoles(data || []);
    setRolesLoading(false);
  }, []);

  // Consolidated handler: fetches profile+roles only if userId changed
  const handleSession = useCallback(async (
    newSession: Session | null,
    isMounted: () => boolean,
    source: string
  ) => {
    if (!isMounted()) return;

    const newUserId = newSession?.user?.id ?? null;

    setSession(newSession);

    // Only update user state if the identity actually changed —
    // prevents cascading re-renders across 20+ components on token refresh / tab switch
    if (newUserId !== currentUserIdRef.current) {
      currentUserIdRef.current = newUserId;
      setUser(newSession?.user ?? null);
    }

    if (newUserId) {
      // Skip if we already fetched for this user (dedup between getSession + onAuthStateChange)
      if (lastFetchedUserId.current === newUserId) {
        if (isMounted()) setIsLoading(false);
        return;
      }
      lastFetchedUserId.current = newUserId;

      await Promise.all([
        fetchProfile(newUserId, newSession!.user.email),
        fetchRoles(newUserId)
      ]);
      if (isMounted()) setIsLoading(false);
    } else {
      lastFetchedUserId.current = null;
      setProfile(null);
      setRoles([]);
      setRolesLoading(false);
      setIsLoading(false);
    }
  }, [fetchProfile, fetchRoles]);

  useEffect(() => {
    let isMounted = true;
    const mounted = () => isMounted;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!isMounted) return;
        
        // Handle password recovery event - redirect to settings
        if (event === "PASSWORD_RECOVERY") {
          console.log("PASSWORD_RECOVERY event detected, redirecting to settings");
          window.location.href = "/dashboard/settings?recovery=true";
          return;
        }

        // On token refresh, just update the session object — no refetches needed
        if (event === "TOKEN_REFRESHED") {
          setSession(session);
          return;
        }
        
        // Use setTimeout(0) to avoid Supabase deadlock warning
        setTimeout(() => handleSession(session, mounted, "onAuthStateChange"), 0);
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      handleSession(session, mounted, "getSession");
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [handleSession]);

  const signUp = async (email: string, password: string, fullName?: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin,
        data: {
          full_name: fullName,
        },
      },
    });
    return { data, error };
  };

  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { data, error };
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    return { error };
  };

  const hasRole = (role: "admin" | "manager" | "agent") => {
    return roles.some((r) => r.role === role);
  };

  const isAdmin = hasRole("admin");
  const isManager = hasRole("manager");
  const isAgent = hasRole("agent");
  const isFullyLoaded = !isLoading && !rolesLoading;

  const value: AuthContextValue = {
    user,
    session,
    profile,
    roles,
    isLoading: !isFullyLoaded,
    isAdmin,
    isManager,
    isAgent,
    hasRole,
    signUp,
    signIn,
    signOut,
    refreshProfile: () => user && fetchProfile(user.id),
  };

  return React.createElement(AuthContext.Provider, { value }, children);
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
