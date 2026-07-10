/**
 * EXECUTION ROUTE — /team/execution
 *
 * Renders the Execution Dashboard for the latest available ExecutionProject.
 * Uses MOCK_EXECUTION (ExampleCo seed) when EXECUTION_STORE is empty.
 * Requires team login.
 */

import { Navigate } from 'react-router';
import { useApp }    from '@/app/contexts/AppContext';
import { ExecutionDashboard }    from '@/app/components/ExecutionDashboard';
import { EXECUTION_STORE, MOCK_EXECUTION } from '@/app/core/executionEngine';

export function ExecutionRoute() {
  const { teamAccessToken } = useApp();

  if (!teamAccessToken) {
    return <Navigate to="/team/login" replace />;
  }

  // Use latest execution in store, or fall back to seeded mock
  const project = EXECUTION_STORE.length > 0
    ? EXECUTION_STORE[EXECUTION_STORE.length - 1]
    : MOCK_EXECUTION;

  return <ExecutionDashboard project={project} />;
}