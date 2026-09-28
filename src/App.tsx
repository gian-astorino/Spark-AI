import { Container, Stack } from '@skyground-media/pipelean-design-system'
import { Onboarding } from './onboarding/Onboarding.tsx'

export default function App() {
  return (
    <Container size="sm">
      <Stack gap={6} padding={6}>
        <Onboarding />
      </Stack>
    </Container>
  )
}
