import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@skyground-media/pipelean-design-system'

// Placeholder until the onboarding steps are defined.
export function Onboarding() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Welcome to Spark</CardTitle>
        <CardDescription>Let's get your workspace ready.</CardDescription>
      </CardHeader>
      <CardContent />
      <CardFooter>
        <Button>Get started</Button>
      </CardFooter>
    </Card>
  )
}
