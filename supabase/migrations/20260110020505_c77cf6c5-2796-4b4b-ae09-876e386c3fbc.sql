-- Create enum for user roles
CREATE TYPE public.app_role AS ENUM ('admin', 'manager', 'agent');

-- Create enum for application status
CREATE TYPE public.application_status AS ENUM ('new', 'reviewing', 'interview', 'contracting', 'approved', 'rejected');

-- Create enum for agent status
CREATE TYPE public.agent_status AS ENUM ('active', 'inactive', 'pending', 'terminated');

-- Create enum for license status
CREATE TYPE public.license_status AS ENUM ('licensed', 'unlicensed', 'pending');

-- Create profiles table
CREATE TABLE public.profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
    email TEXT NOT NULL,
    full_name TEXT,
    phone TEXT,
    avatar_url TEXT,
    bio TEXT,
    city TEXT,
    state TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Create user_roles table (separate from profiles for security)
CREATE TABLE public.user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    role app_role NOT NULL DEFAULT 'agent',
    UNIQUE (user_id, role)
);

-- Create agents table
CREATE TABLE public.agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    profile_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    manager_id UUID REFERENCES public.agents(id) ON DELETE SET NULL,
    agent_code TEXT UNIQUE,
    license_status license_status DEFAULT 'unlicensed' NOT NULL,
    license_states TEXT[],
    nipr_number TEXT,
    status agent_status DEFAULT 'pending' NOT NULL,
    start_date DATE,
    total_policies INTEGER DEFAULT 0,
    total_premium DECIMAL(12, 2) DEFAULT 0,
    total_earnings DECIMAL(12, 2) DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Create applications table
CREATE TABLE public.applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Personal Info
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL,
    city TEXT,
    state TEXT,
    -- Licensing
    license_status license_status DEFAULT 'unlicensed' NOT NULL,
    licensed_states TEXT[],
    nipr_number TEXT,
    -- Experience
    has_insurance_experience BOOLEAN DEFAULT false,
    years_experience INTEGER DEFAULT 0,
    previous_company TEXT,
    previous_production DECIMAL(12, 2),
    -- Goals
    desired_income DECIMAL(12, 2),
    availability TEXT,
    start_date DATE,
    referral_source TEXT,
    -- Documents
    resume_url TEXT,
    license_doc_url TEXT,
    -- Status
    status application_status DEFAULT 'new' NOT NULL,
    notes TEXT,
    reviewed_by UUID REFERENCES auth.users(id),
    reviewed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Create agent_metrics table for tracking performance
CREATE TABLE public.agent_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID REFERENCES public.agents(id) ON DELETE CASCADE NOT NULL,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    policies_sold INTEGER DEFAULT 0,
    premium_volume DECIMAL(12, 2) DEFAULT 0,
    earnings DECIMAL(12, 2) DEFAULT 0,
    close_rate DECIMAL(5, 2) DEFAULT 0,
    leads_generated INTEGER DEFAULT 0,
    appointments_set INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Create achievements table
CREATE TABLE public.achievements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    icon TEXT,
    threshold_type TEXT,
    threshold_value DECIMAL(12, 2),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Create agent_achievements junction table
CREATE TABLE public.agent_achievements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID REFERENCES public.agents(id) ON DELETE CASCADE NOT NULL,
    achievement_id UUID REFERENCES public.achievements(id) ON DELETE CASCADE NOT NULL,
    earned_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    UNIQUE (agent_id, achievement_id)
);

-- Create resources table for training materials
CREATE TABLE public.resources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    description TEXT,
    category TEXT NOT NULL,
    type TEXT NOT NULL, -- video, document, script, faq
    url TEXT,
    content TEXT,
    thumbnail_url TEXT,
    is_featured BOOLEAN DEFAULT false,
    order_index INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Create announcements table
CREATE TABLE public.announcements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    priority TEXT DEFAULT 'normal',
    is_active BOOLEAN DEFAULT true,
    published_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    expires_at TIMESTAMP WITH TIME ZONE,
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Create activity_logs table
CREATE TABLE public.activity_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    entity_type TEXT,
    entity_id UUID,
    details JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Create lead_counter table for landing page
CREATE TABLE public.lead_counter (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    count INTEGER DEFAULT 0 NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Insert initial lead counter
INSERT INTO public.lead_counter (count) VALUES (15847);

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_counter ENABLE ROW LEVEL SECURITY;

-- Create security definer function to check roles (prevents RLS recursion)
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.user_roles
        WHERE user_id = _user_id
          AND role = _role
    )
$$;

-- Create function to get user's agent_id
CREATE OR REPLACE FUNCTION public.get_agent_id(_user_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT id FROM public.agents WHERE user_id = _user_id LIMIT 1
$$;

-- Profiles policies
CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins can view all profiles" ON public.profiles FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Managers can view team profiles" ON public.profiles FOR SELECT USING (public.has_role(auth.uid(), 'manager'));

-- User roles policies
CREATE POLICY "Users can view own roles" ON public.user_roles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins can manage all roles" ON public.user_roles FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- Agents policies
CREATE POLICY "Agents can view own record" ON public.agents FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Agents can update own record" ON public.agents FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Admins can manage all agents" ON public.agents FOR ALL USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Managers can view their team" ON public.agents FOR SELECT USING (
    public.has_role(auth.uid(), 'manager') AND (
        manager_id = public.get_agent_id(auth.uid()) OR user_id = auth.uid()
    )
);

-- Applications policies (public insert for applicants, restricted view)
CREATE POLICY "Anyone can submit application" ON public.applications FOR INSERT WITH CHECK (true);
CREATE POLICY "Applicants can view own application" ON public.applications FOR SELECT USING (email = (SELECT email FROM auth.users WHERE id = auth.uid()));
CREATE POLICY "Admins can manage all applications" ON public.applications FOR ALL USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Managers can view applications" ON public.applications FOR SELECT USING (public.has_role(auth.uid(), 'manager'));

-- Agent metrics policies
CREATE POLICY "Agents can view own metrics" ON public.agent_metrics FOR SELECT USING (
    agent_id = public.get_agent_id(auth.uid())
);
CREATE POLICY "Admins can manage all metrics" ON public.agent_metrics FOR ALL USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Managers can view team metrics" ON public.agent_metrics FOR SELECT USING (public.has_role(auth.uid(), 'manager'));

-- Achievements policies (public read)
CREATE POLICY "Anyone can view achievements" ON public.achievements FOR SELECT USING (true);
CREATE POLICY "Admins can manage achievements" ON public.achievements FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- Agent achievements policies
CREATE POLICY "Agents can view own achievements" ON public.agent_achievements FOR SELECT USING (
    agent_id = public.get_agent_id(auth.uid())
);
CREATE POLICY "Admins can manage agent achievements" ON public.agent_achievements FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- Resources policies (authenticated read)
CREATE POLICY "Authenticated users can view resources" ON public.resources FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage resources" ON public.resources FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- Announcements policies (authenticated read active)
CREATE POLICY "Authenticated users can view active announcements" ON public.announcements FOR SELECT TO authenticated USING (is_active = true);
CREATE POLICY "Admins can manage announcements" ON public.announcements FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- Activity logs policies
CREATE POLICY "Users can view own activity" ON public.activity_logs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins can view all activity" ON public.activity_logs FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "System can insert logs" ON public.activity_logs FOR INSERT WITH CHECK (true);

-- Lead counter policies (public read)
CREATE POLICY "Anyone can view lead counter" ON public.lead_counter FOR SELECT USING (true);
CREATE POLICY "Admins can update lead counter" ON public.lead_counter FOR UPDATE USING (public.has_role(auth.uid(), 'admin'));

-- Create function to handle new user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.profiles (user_id, email, full_name)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email)
    );
    
    -- Default role is agent
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'agent');
    
    RETURN NEW;
END;
$$;

-- Create trigger for new user signup
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Create function to update timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

-- Create triggers for updated_at
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_agents_updated_at BEFORE UPDATE ON public.agents FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_applications_updated_at BEFORE UPDATE ON public.applications FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_resources_updated_at BEFORE UPDATE ON public.resources FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Insert sample achievements
INSERT INTO public.achievements (name, description, icon, threshold_type, threshold_value) VALUES
('First Policy', 'Sold your first insurance policy', 'award', 'policies', 1),
('Rising Star', 'Sold 10 policies', 'star', 'policies', 10),
('Top Producer', 'Earned $100,000 in commissions', 'trophy', 'earnings', 100000),
('Premium Player', 'Generated $1M in premium volume', 'crown', 'premium', 1000000),
('Closer', 'Achieved 50% close rate', 'target', 'close_rate', 50);

-- Insert sample resources
INSERT INTO public.resources (title, description, category, type, is_featured, order_index) VALUES
('Welcome to APEX', 'Get started with your new career at APEX Financial Empire', 'Onboarding', 'video', true, 1),
('Life Insurance 101', 'Understanding the fundamentals of life insurance products', 'Training', 'video', true, 2),
('Sales Script - Initial Contact', 'Proven script for making first contact with leads', 'Scripts', 'document', false, 3),
('Objection Handling Guide', 'How to handle common objections and close more deals', 'Training', 'document', true, 4),
('Compliance Guidelines', 'Important compliance rules and regulations', 'Compliance', 'document', false, 5);