export async function fetchUserFeatureAccess(): Promise<{
  multiEdit: boolean;
}> {
  return { multiEdit: true };
}

export function clearFeatureAccessCache(): void {
  // Feature access is now available to every authenticated user.
}

export async function isAuthorizedForMultiEdit(): Promise<boolean> {
  return true;
}
