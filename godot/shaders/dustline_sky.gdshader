// The Dustline sky: the same three-band gradient and sun glow as the web
// game's sky dome (game.js buildSky).
shader_type sky;

uniform vec3 horizon_color : source_color = vec3(0.93, 0.74, 0.55);
uniform vec3 mid_color : source_color = vec3(0.7, 0.72, 0.72);
uniform vec3 zenith_color : source_color = vec3(0.33, 0.5, 0.62);
uniform vec3 sun_dir = vec3(-0.55, 0.42, 0.72);

void sky() {
	float h = clamp(EYEDIR.y, -0.2, 1.0);
	vec3 col = mix(horizon_color, mid_color, smoothstep(0.0, 0.25, h));
	col = mix(col, zenith_color, smoothstep(0.25, 0.9, h));
	float s = max(dot(EYEDIR, normalize(sun_dir)), 0.0);
	col += vec3(1.0, 0.75, 0.45) * pow(s, 8.0) * 0.45;
	col += vec3(1.0, 0.9, 0.7) * pow(s, 400.0) * 3.0;
	if (h < 0.0) {
		col = mix(col, vec3(0.6, 0.5, 0.4), -h * 4.0);
	}
	COLOR = col;
}
