function Component(metadata: { selector?: string }): ClassDecorator {
  return () => undefined;
}

@Component({ selector: 'not-an-angular-component' })
export class LocalDecoratedClass {}
