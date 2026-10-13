import { useEffect } from 'react'
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation } from 'react-router-dom'
import { TooltipProvider } from '@/shared/ui/Tooltip'
import { Toaster } from '@/shared/ui/Toast'
import { useProfileStore } from '@/features/profile/profileStore'
import { Shell } from '@/app/Shell'
import { LandingPage } from '@/pages/LandingPage'
import { OnboardingPage } from '@/pages/OnboardingPage'
import { PlacementPage } from '@/pages/PlacementPage'
import { CampPage } from '@/pages/CampPage'
import { ModulePage } from '@/pages/ModulePage'
import { DrillPage } from '@/pages/DrillPage'
import { SkillsPage } from '@/pages/SkillsPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { CoursePage } from '@/pages/CoursePage'
import { LessonPage } from '@/pages/LessonPage'
import { PortfolioPage } from '@/pages/PortfolioPage'
import { TunerPage } from '@/pages/TunerPage'
import { StudioPage } from '@/pages/StudioPage'
import { AIPracticePage } from '@/pages/AIPracticePage'
import { GraduationPage } from '@/pages/GraduationPage'
import { GuitarPage } from '@/pages/GuitarPage'
import { GuitarSetupPage } from '@/pages/GuitarSetupPage'
import { GuitarTonePage } from '@/pages/GuitarTonePage'
import { GuitarUnitPage } from '@/pages/GuitarUnitPage'
import { GuitarAIPage } from '@/pages/GuitarAIPage'
import { SongsPage } from '@/pages/SongsPage'
import { SongDetailPage } from '@/pages/SongDetailPage'
import { SheetsPage } from '@/pages/SheetsPage'
import { SheetDetailPage } from '@/pages/SheetDetailPage'
import { SingListPage } from '@/pages/SingListPage'
import { SingPage } from '@/pages/SingPage'
import { LibraryPage } from '@/pages/LibraryPage'
import { RunService } from '@/services/runService'

/** Loads the profile once; children render after it is available. */
function Bootstrap() {
  const profile = useProfileStore((s) => s.profile)
  const load = useProfileStore((s) => s.load)
  useEffect(() => {
    void load().then(() => RunService.cleanup()).catch(() => undefined)
  }, [load])
  if (!profile) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground" aria-busy="true">
        正在打开工作室…
      </div>
    )
  }
  return <Outlet />
}

/** Routes that need a finished onboarding. */
function RequireSetup() {
  const profile = useProfileStore((s) => s.profile)
  const location = useLocation()
  if (profile && !profile.setupDone) return <Navigate to="/start" replace state={{ from: location.pathname }} />
  return <Outlet />
}

const router = createBrowserRouter([
  {
    element: <Bootstrap />,
    children: [
      { path: '/', element: <LandingPage /> },
      { path: '/start', element: <OnboardingPage /> },
      {
        element: <RequireSetup />,
        children: [
          { path: '/placement', element: <PlacementPage /> },
          {
            element: <Shell />,
            children: [
              { path: '/camp', element: <CampPage /> },
              { path: '/camp/ai', element: <AIPracticePage /> },
              { path: '/camp/:moduleId', element: <ModulePage /> },
              { path: '/drill/:moduleId', element: <DrillPage /> },
              { path: '/course', element: <CoursePage /> },
              { path: '/course/:lessonId', element: <LessonPage /> },
              { path: '/portfolio', element: <PortfolioPage /> },
              { path: '/tuner', element: <TunerPage /> },
              { path: '/studio', element: <StudioPage /> },
              { path: '/graduation', element: <GraduationPage /> },
              { path: '/songs', element: <SongsPage /> },
              { path: '/songs/:kind/:id', element: <SongDetailPage /> },
              { path: '/sheets', element: <SheetsPage /> },
              { path: '/sheets/:id', element: <SheetDetailPage /> },
              { path: '/library', element: <LibraryPage /> },
              { path: '/sing', element: <SingListPage /> },
              { path: '/sing/:kind/:id', element: <SingPage /> },
              { path: '/guitar', element: <GuitarPage /> },
              { path: '/guitar/setup', element: <GuitarSetupPage /> },
              { path: '/guitar/tone', element: <GuitarTonePage /> },
              { path: '/guitar/ai', element: <GuitarAIPage /> },
              { path: '/guitar/:unitId', element: <GuitarUnitPage /> },
              { path: '/skills', element: <SkillsPage /> },
              { path: '/settings', element: <SettingsPage /> },
            ],
          },
        ],
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
])

export function App() {
  return (
    <TooltipProvider delayDuration={200}>
      <RouterProvider router={router} />
      <Toaster />
    </TooltipProvider>
  )
}
