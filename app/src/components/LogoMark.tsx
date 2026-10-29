import logo from "./zelux-logo.png";

export function LogoMark({ size = 22 }: { size?: number; glass?: "white" | "indigo" }) {
  return <img src={logo} width={size} height={size} alt="" className="logo-mark" />;
}

export function BrandTile({ size = 28 }: { size?: number }) {
  return (
    <span className="brand-tile" style={{ width: size, height: size, borderRadius: size * 0.29 }}>
      <LogoMark size={Math.round(size * 0.78)} />
    </span>
  );
}
