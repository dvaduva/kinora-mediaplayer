import { useEffect, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { useFocusable } from "@noriginmedia/norigin-spatial-navigation";

type Props = {
  children: ReactNode;
  className?: string;
  focusKey?: string;
  focusOnMount?: boolean;
  onEnterPress?: () => void;
  onArrowPress?: (direction: string) => boolean;
  onFocus?: () => void;
  style?: CSSProperties;
};

export function Focusable(props: Props) {
  const { ref, focused, focusSelf } = useFocusable({
    focusKey: props.focusKey,
    onEnterPress: props.onEnterPress,
    onArrowPress: props.onArrowPress,
    onFocus: props.onFocus ? () => props.onFocus?.() : undefined,
  });

  useEffect(() => {
    if (props.focusOnMount) focusSelf();
  }, [props.focusOnMount, focusSelf]);

  function activate() {
    props.onEnterPress?.();
  }

  function onClick(event: MouseEvent<HTMLDivElement>) {
    if (!props.onEnterPress) return;
    event.preventDefault();
    focusSelf();
    activate();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!props.onEnterPress) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    activate();
  }

  return (
    <div
      ref={ref}
      role={props.onEnterPress ? "button" : undefined}
      tabIndex={props.onEnterPress ? 0 : undefined}
      className={[props.className, focused ? "is-focused" : ""].filter(Boolean).join(" ")}
      style={props.style}
      data-focused={focused ? "true" : undefined}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      {props.children}
    </div>
  );
}
