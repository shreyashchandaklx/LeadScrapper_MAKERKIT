import { use } from 'react';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import * as z from 'zod';

import { UserWorkspaceContextProvider } from '@kit/accounts/components';
import { Page, PageMobileNavigation, PageNavigation } from '@kit/ui/page';
import { SidebarProvider } from '@kit/ui/sidebar';

import { AppLogo } from '~/components/app-logo';
import featuresFlagConfig from '~/config/feature-flags.config';
import pathsConfig from '~/config/paths.config';
import { personalAccountNavigationConfig } from '~/config/personal-account-navigation.config';

// home imports
import { HomeMenuNavigation } from './_components/home-menu-navigation';
import { HomeMobileNavigation } from './_components/home-mobile-navigation';
import { HomeSidebar } from './_components/home-sidebar';
import { LeadscrapperTopBar } from './_components/leadscrapper-top-bar';
import { loadUserWorkspace } from './_lib/server/load-user-workspace';

function UserHomeLayout({ children }: React.PropsWithChildren) {
  const state = use(getLayoutState());

  if (state.style === 'sidebar') {
    return <SidebarLayout>{children}</SidebarLayout>;
  }

  return <HeaderLayout>{children}</HeaderLayout>;
}

export default UserHomeLayout;

async function SidebarLayout({ children }: React.PropsWithChildren) {
  const [workspace, state] = await Promise.all([
    loadUserWorkspace().catch(() => null),
    getLayoutState(),
  ]);

  if (!workspace) {
    redirect('/');
  }

  await redirectIfTeamsOnly(workspace);

  return (
    <UserWorkspaceContextProvider value={workspace}>
      <SidebarProvider defaultOpen={state.open}>
        <Page style={'sidebar'}>
          <PageNavigation>
            <HomeSidebar workspace={workspace} />
          </PageNavigation>

          <PageMobileNavigation>
            <MobileNavigation workspace={workspace} />
          </PageMobileNavigation>

          <div className="flex flex-1 flex-col min-w-0">
            <LeadscrapperTopBar />
            {children}
          </div>
        </Page>
      </SidebarProvider>
    </UserWorkspaceContextProvider>
  );
}

async function HeaderLayout({ children }: React.PropsWithChildren) {
  const workspace = await loadUserWorkspace();

  await redirectIfTeamsOnly(workspace);

  return (
    <UserWorkspaceContextProvider value={workspace}>
      <Page style={'header'}>
        <PageNavigation>
          <HomeMenuNavigation workspace={workspace} />
        </PageNavigation>

        <PageMobileNavigation>
          <MobileNavigation workspace={workspace} />
        </PageMobileNavigation>

        <div className="flex flex-1 flex-col min-w-0">
          <LeadscrapperTopBar />
          {children}
        </div>
      </Page>
    </UserWorkspaceContextProvider>
  );
}

function MobileNavigation({
  workspace,
}: {
  workspace: Awaited<ReturnType<typeof loadUserWorkspace>>;
}) {
  return (
    <>
      <div>
        <AppLogo />
      </div>

      <HomeMobileNavigation workspace={workspace} />
    </>
  );
}

async function redirectIfTeamsOnly(
  workspace: Awaited<ReturnType<typeof loadUserWorkspace>>,
) {
  if (featuresFlagConfig.enableTeamsOnly) {
    const firstTeam = workspace.accounts[0];

    if (firstTeam?.value) {
      const cookieStore = await cookies();
      const lastSelected = cookieStore.get('last-selected-team')?.value;

      const preferred = lastSelected
        ? workspace.accounts.find((a) => a.value === lastSelected)
        : undefined;

      const team = preferred ?? firstTeam;

      redirect(pathsConfig.app.accountHome.replace('[account]', team.value!));
    } else {
      redirect(pathsConfig.app.createTeam);
    }
  }
}

async function getLayoutState() {
  const cookieStore = await cookies();

  const LayoutStyleSchema = z.enum(['sidebar', 'header', 'custom']);

  const layoutStyleCookie = cookieStore.get('layout-style');
  const sidebarOpenCookie = cookieStore.get('sidebar_state');

  const sidebarOpen = sidebarOpenCookie
    ? sidebarOpenCookie.value === 'true'
    : !personalAccountNavigationConfig.sidebarCollapsed;

  const parsedStyle = LayoutStyleSchema.safeParse(layoutStyleCookie?.value);

  const style = parsedStyle.success
    ? parsedStyle.data
    : personalAccountNavigationConfig.style;

  return {
    open: sidebarOpen,
    style,
  };
}
